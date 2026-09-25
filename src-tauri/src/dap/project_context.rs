//! 项目上下文：把 `AppStateWrapper` 的项目事实翻译成 DAP 需要的环境输入。
//!
//! 职责边界（单一职责）：本模块只回答"这个项目在 DAP 眼里是什么"——
//! 项目根路径、执行环境上的适配器可用性、用户级适配器二进制覆盖。
//! 不持有会话、不读写断点、不做 launch.json IO（那些在 `manager` / `launch_config`）。
//!
//! 这些函数此前是 `DapManager` 上**不使用 `self`** 的关联函数：命名空间吸附在
//! 管理器上，既让管理器看起来承担了配置职责，也让调用方误以为需要管理器实例。

use std::path::PathBuf;

use super::adapter;
use crate::common::executor::factory::ExecTarget;
use crate::dap::types::AdapterKind;
use crate::AppError;
use crate::AppStateWrapper;

/// 项目的根路径。
///
/// 短临界区 std 锁：只在表里取一条记录后立刻 clone 出去，不跨 await（既有模式）。
pub fn project_path(state: &AppStateWrapper, project_id: &str) -> Result<PathBuf, AppError> {
    let pm = state.project_manager.lock().map_err(AppError::from)?;
    let project = pm
        .get_project(project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
    Ok(project.path.clone())
}

/// 项目的执行环境（Local / WSL / Remote）。
///
/// 环境解析是编排层职责；仅模块内 `check_adapter` 消费，不对外暴露。
fn exec_target(state: &AppStateWrapper, project_id: &str) -> Result<ExecTarget, AppError> {
    Ok(state.project_environment(project_id)?.to_exec_target())
}

/// 适配器在**项目环境**（Local / WSL / SSH）内是否可用。
///
/// 未知 adapter 类型 → `false`（`adapter_available` 的既有语义），未知项目 → `NotFound`
/// 原样上抛（不静默降级为"不可用"）。
pub async fn check_adapter(
    state: &AppStateWrapper,
    project_id: &str,
    adapter_type: &str,
) -> Result<bool, AppError> {
    let target = exec_target(state, project_id)?;
    Ok(adapter::adapter_available(adapter_type, &target).await)
}

/// 读取 config `dap.adapterBinaries.<kind>`（对齐 Zed `dap.$ADAPTER.binary`）：
/// 用户显式指定的 adapter 二进制（如自定义 codelldb / lldb-dap / dlv），
/// 存在则覆盖默认探测。配置缺省 / 空串 / 读取失败 → `None`（走默认探测）。
///
/// ## 键空间在**读取入口**归一（`src/AGENTS.md` 红线 12）
///
/// 规范键是 [`AdapterKind::as_str`]（`go` / `lldb` / `java`），但同时接受 launch.json
/// 的 `type` 别名（`delve` / `rust` / `codelldb` / `junit`）—— 归一用的是与编排后端
/// 注册表**同一个事实源** [`AdapterKind::from_config_type`]，因此不存在"某一侧支持别名、
/// 另一侧不支持"的分裂：
///
/// | 用户写的 key | 归一到 |
/// |---|---|
/// | `go` / `delve` | `AdapterKind::Go` |
/// | `lldb` / `rust` / `codelldb` | `AdapterKind::Lldb` |
/// | `java` / `junit` | `AdapterKind::Java` |
///
/// 优先级：**规范键恒优先**；规范键缺失或为空串时依次看别名（对象键有序 ⇒ 确定性）。
/// 无法归一的键（如 `python`）忽略 —— 那类 key 本来也没有可用适配器。
///
/// **异步**：`load_config` 是阻塞文件读（Gate #3）；`StorageManager` 只含一个 `PathBuf`
/// 且 `Clone`，克隆后即可安全移交阻塞线程池。
pub async fn adapter_binary_override(state: &AppStateWrapper, kind: AdapterKind) -> Option<String> {
    let storage = state.storage_manager.clone();
    let config = crate::common::runtime::run_blocking_result(move || {
        storage.load_config().map_err(AppError::from)
    })
    .await
    .ok()?;
    let binaries = config.pointer("/dap/adapterBinaries")?.as_object()?;

    // 1) 规范键优先。
    if let Some(override_path) = binaries.get(kind.as_str()).and_then(usable_override) {
        return Some(override_path.to_string());
    }
    // 2) 其次按别名归一（同一个事实源），取第一个可用者。
    binaries
        .iter()
        .find(|(key, value)| {
            AdapterKind::from_config_type(key).ok() == Some(kind)
                && usable_override(value).is_some()
        })
        .and_then(|(_, value)| usable_override(value))
        .map(str::to_string)
}

/// 可用的覆盖值：**非空字符串**。空串 / `null` / 数字等一律视为"没配"
/// （`resolve_spawn` 只把非空串当覆盖，空串透传会变成 spawn 空程序名这类不可诊断的失败）。
fn usable_override(value: &serde_json::Value) -> Option<&str> {
    value.as_str().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::testing::{isolated_state, plain_project_state};

    /// 环境解析在编排层：未知项目 → `project_environment` 的 `NotFound` 原样上抛，
    /// 不静默降级为「不可用」。
    #[tokio::test]
    async fn check_adapter_propagates_unknown_project_as_not_found() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        assert!(matches!(
            check_adapter(&state, "no-such-project", "go").await,
            Err(AppError::NotFound(_))
        ));
    }

    /// 已注册项目 + 未知 adapter 类型 → 走完 `project_environment` → `to_exec_target` →
    /// `adapter_available` 全链路，确定性得 `false`（未知 kind 不触碰文件系统/环境，
    /// 因此不受本机是否装了 dlv / lldb 影响）。
    #[tokio::test]
    async fn check_adapter_resolves_project_env_then_reports_unavailable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state(&tmp);

        let result = check_adapter(&state, &project_id, "no-such-adapter").await;
        assert!(matches!(result, Ok(false)), "got {result:?}");
    }

    /// 未知项目取项目根 → `NotFound`（与 `check_adapter` 同一错误口径）。
    #[test]
    fn project_path_maps_unknown_project_to_not_found() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        assert!(matches!(
            project_path(&state, "missing"),
            Err(AppError::NotFound(_))
        ));
    }

    // ── `dap.adapterBinaries.<kind>`（用户级 adapter 二进制覆盖）──────────────
    //
    // 覆盖三条分支：命中 / 空串 / 缺省（键缺、类型错、文件缺、JSON 坏）。
    // 缺省一律返回 `None` = 走默认探测，绝不因为配置读取失败而阻断启动。

    /// 写一份 `~/.neeko/config.json`（`isolated_state` 的 config_dir 指向 tempdir）。
    fn write_config(tmp: &tempfile::TempDir, config: serde_json::Value) {
        let dir = tmp.path().join(".neeko");
        std::fs::create_dir_all(&dir).expect("mkdir .neeko");
        std::fs::write(
            dir.join("config.json"),
            serde_json::to_string_pretty(&config).expect("serialize"),
        )
        .expect("write config.json");
    }

    /// 命中：按 `AdapterKind::as_str()` 取键，返回用户指定的二进制路径。
    #[tokio::test]
    async fn adapter_binary_override_reads_the_kind_key() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        write_config(
            &tmp,
            serde_json::json!({
                "dap": { "adapterBinaries": { "go": "/custom/dlv", "lldb": "/custom/codelldb" } }
            }),
        );

        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Go)
                .await
                .as_deref(),
            Some("/custom/dlv")
        );
        // 键是**语言 kind**：别的 kind 的键不会串味。
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Lldb)
                .await
                .as_deref(),
            Some("/custom/codelldb")
        );
        // 未配置的 kind → None（回落到默认探测）。
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Java).await,
            None
        );
    }

    /// 空串 / 非字符串 / 结构不是对象 → 一律视为"没配"（`None`）。
    ///
    /// 空串必须回落默认探测：`resolve_spawn` 只把非空串当覆盖，空串透传会变成
    /// "spawn 空程序名"这类不可诊断的失败。
    #[tokio::test]
    async fn adapter_binary_override_ignores_empty_and_malformed_values() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        for (label, config) in [
            (
                "空串（规范键）",
                serde_json::json!({"dap": {"adapterBinaries": {"go": ""}}}),
            ),
            (
                "空串（别名键）",
                serde_json::json!({"dap": {"adapterBinaries": {"delve": ""}}}),
            ),
            (
                "数字",
                serde_json::json!({"dap": {"adapterBinaries": {"go": 42}}}),
            ),
            (
                "null",
                serde_json::json!({"dap": {"adapterBinaries": {"go": null}}}),
            ),
            (
                "不是对象",
                serde_json::json!({"dap": {"adapterBinaries": "/custom/dlv"}}),
            ),
        ] {
            write_config(&tmp, config);
            assert_eq!(
                adapter_binary_override(&state, AdapterKind::Go).await,
                None,
                "{label} 必须视为未配置"
            );
        }
    }

    /// **别名陷阱已修（回归）**：键空间在读取入口按 `AdapterKind::from_config_type` 归一，
    /// 用户按 launch.json 的 `type` 写 key（`delve` / `rust` / `codelldb` / `junit`）也能生效。
    ///
    /// 回归背景：修前只读 `AdapterKind::as_str()`（`go`/`lldb`/`java`），写 `rust` 的覆盖
    /// 被**静默忽略**、回落默认探测，用户看到"我配了路径却没用"。
    #[tokio::test]
    async fn adapter_binary_override_accepts_launch_type_aliases() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        write_config(
            &tmp,
            serde_json::json!({
                "dap": { "adapterBinaries": {
                    "delve": "/p/dlv",
                    "codelldb": "/p/codelldb",
                    "junit": "/p/java-host"
                }}
            }),
        );

        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Go)
                .await
                .as_deref(),
            Some("/p/dlv"),
            "`delve` 必须归一到 Go"
        );
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Lldb)
                .await
                .as_deref(),
            Some("/p/codelldb"),
            "`codelldb` 必须归一到 Lldb"
        );
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Java)
                .await
                .as_deref(),
            Some("/p/java-host"),
            "`junit` 必须归一到 Java"
        );

        // 无法归一的键忽略（那类 key 本来也没有可用适配器），不报错。
        write_config(
            &tmp,
            serde_json::json!({"dap": {"adapterBinaries": {"python": "/p/debugpy"}}}),
        );
        assert_eq!(adapter_binary_override(&state, AdapterKind::Go).await, None);
    }

    /// 优先级：**规范键恒优先**；规范键为空串时由别名顶上（空串 = 没配）。
    #[tokio::test]
    async fn canonical_key_wins_over_alias_and_alias_covers_empty_canonical() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        write_config(
            &tmp,
            serde_json::json!({
                "dap": { "adapterBinaries": { "lldb": "/p/canonical", "rust": "/p/alias" } }
            }),
        );
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Lldb)
                .await
                .as_deref(),
            Some("/p/canonical"),
            "规范键必须胜出（同 kind 的多个键同时存在时以规范键为准）"
        );

        write_config(
            &tmp,
            serde_json::json!({
                "dap": { "adapterBinaries": { "lldb": "", "rust": "/p/alias" } }
            }),
        );
        assert_eq!(
            adapter_binary_override(&state, AdapterKind::Lldb)
                .await
                .as_deref(),
            Some("/p/alias"),
            "规范键为空串 = 未配置，别名应顶上"
        );
    }

    /// 缺省分支：配置文件不存在 / 无该键 / JSON 损坏 → `None`，**不报错**。
    ///
    /// 覆盖探测失败必须降级成"用默认探测"，不能因为一份坏配置挡住用户调试。
    #[tokio::test]
    async fn adapter_binary_override_falls_back_when_config_missing_or_broken() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        // 1) 配置文件不存在（`load_config` 返回 `{}`）。
        assert_eq!(adapter_binary_override(&state, AdapterKind::Go).await, None);

        // 2) 有文件但无该键。
        write_config(&tmp, serde_json::json!({"dap": {}}));
        assert_eq!(adapter_binary_override(&state, AdapterKind::Go).await, None);

        // 3) JSON 损坏（`load_config` 报错 → 吞成 None）。
        std::fs::write(tmp.path().join(".neeko/config.json"), "{ not json").expect("write");
        assert_eq!(adapter_binary_override(&state, AdapterKind::Go).await, None);
    }
}
