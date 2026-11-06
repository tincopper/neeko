//! `targets` 目录的契约测试：事实表自洽、形态/数据边界、目录解析的 env 回落。
//!
//! 夹具路径全部 `tempdir()` 推导（红线 13）；env 注入经 `ScopedEnv`（RAII 还原）。

use super::data::HOOK_TARGETS;
use super::dirs::{
    claude_config_dir, codebuddy_config_dir, codex_config_dir, omp_extensions_dir,
    opencode_plugins_dir, pi_extensions_dir, qoder_config_dir,
};
use super::entries::CLAUDE_COMPAT_ENTRIES;
use super::shape::{HookEntry, InstallShape};
use crate::agent::chat::notify::event_keys;

/// 进程级 env 的**互斥 + 成对还原**。
///
/// # 为什么必须互斥，而不是只用 RAII
///
/// `std::env::set_var` 改的是**整个进程**的环境。`cargo test` 默认多线程并行，
/// 只做「设值 + 事后还原」仍会失败：
///
/// ```text
/// 线程 A: set("XDG_CONFIG_HOME", tmpA) ──────────────── restore
/// 线程 B:                    set("XDG_CONFIG_HOME", tmpB)   ← 覆盖 A
/// 线程 A: 此刻读到 tmpB，断言炸（表现为偶发失败，重跑就绿）
/// ```
///
/// 所以临界区必须是「从设值到读值完成」的整个测试体，而不是单个调用。
/// `ScopedEnv` 持有全局锁直到 drop —— 调用方写 `let _scoped = ScopedEnv::set(..)`
/// 时，锁的生命周期正好覆盖整个测试。
///
/// 这把锁只在本测试模块内生效；其他模块若也改进程 env，需共用同一个锁
/// （见 [`ENV_LOCK`]）。
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct ScopedEnv {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
    /// 持有到 drop —— 这就是临界区。
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl ScopedEnv {
    fn set(key: &'static str, value: &std::path::Path) -> Self {
        // 锁中毒说明另一个测试在临界区内 panic 了。此时 env 已被 Drop 还原
        // （panic 也会走 drop），继续执行是安全的 —— 取回中毒锁而不是级联 panic。
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self {
            key,
            previous,
            _guard: guard,
        }
    }
}

impl Drop for ScopedEnv {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

/// XDG_CONFIG_HOME 优先（2026-10-12 纠错钉子：macOS 上曾误用 `dirs::config_dir()`
/// 指到 Library/Application Support）。值取 tempdir 派生前缀，不硬编码平台路径。
#[test]
fn opencode_dir_follows_xdg_convention() {
    let base = tempfile::tempdir().expect("tempdir");
    let _scoped = ScopedEnv::set("XDG_CONFIG_HOME", base.path());
    let expected = base.path().join("opencode").join("plugins");
    assert_eq!(opencode_plugins_dir(), Some(expected));
}

/// 空 XDG_CONFIG_HOME 视同未设置（否则会得到相对路径 `opencode/plugins`）。
#[test]
fn empty_xdg_value_falls_back_to_home() {
    let _scoped = ScopedEnv::set("XDG_CONFIG_HOME", std::path::Path::new(""));
    let got = opencode_plugins_dir().expect("home-derived");
    assert!(
        got.is_absolute() && got.ends_with("opencode/plugins"),
        "must derive from home dir, got {got:?}"
    );
}

/// 相对 XDG_CONFIG_HOME 同样视为无效（XDG Spec §2 要求绝对路径）。
///
/// 只判空时相对值会被接受 —— install 写出 CWD 相对路径、status 却在别处查找，
/// 表现为「装了但报未安装」且随 CWD 漂移。
#[test]
fn relative_xdg_value_falls_back_to_home() {
    let _scoped = ScopedEnv::set("XDG_CONFIG_HOME", std::path::Path::new("relative/config"));
    let got = opencode_plugins_dir().expect("home-derived");
    assert!(
        got.is_absolute() && got.ends_with("opencode/plugins"),
        "相对值必须被忽略并回落 home，got {got:?}"
    );
}

/// pi 目录约定（`.pi/agent/extensions`）。
#[test]
fn pi_dir_sits_under_home() {
    let got = pi_extensions_dir().expect("home");
    assert!(got.is_absolute());
    assert!(got.ends_with(std::path::Path::new(".pi").join("agent").join("extensions")));
}

/// OMP 目录约定（`.omp/agent/extensions`）—— 与 pi 同形但不同根，两者不得混淆。
#[test]
fn omp_dir_sits_under_home_and_differs_from_pi() {
    let omp = omp_extensions_dir().expect("home");
    assert!(omp.is_absolute());
    assert!(omp.ends_with(
        std::path::Path::new(".omp")
            .join("agent")
            .join("extensions")
    ));
    assert_ne!(Some(omp), pi_extensions_dir(), "OMP 与 pi 的目录必须不同");
}

/// Claude 目录约定（`.claude`）；`CLAUDE_CONFIG_DIR` 绝对路径优先。
#[test]
fn claude_dir_honors_config_dir_env() {
    let base = tempfile::tempdir().expect("tempdir");
    let _scoped = ScopedEnv::set("CLAUDE_CONFIG_DIR", base.path());
    assert_eq!(claude_config_dir(), Some(base.path().to_path_buf()));
}

/// 相对 `CLAUDE_CONFIG_DIR` 视为无效并回落 home（与 XDG 同判据）。
#[test]
fn relative_claude_config_dir_falls_back_to_home() {
    let _scoped = ScopedEnv::set("CLAUDE_CONFIG_DIR", std::path::Path::new("rel/dir"));
    let got = claude_config_dir().expect("home-derived");
    assert!(got.is_absolute() && got.ends_with(".claude"), "got {got:?}");
}

/// CodeBuddy / Qoder 目录约定（`.codebuddy` / `.qoder`）。
#[test]
fn codebuddy_and_qoder_dirs_sit_under_home() {
    let cb = codebuddy_config_dir().expect("home");
    assert!(cb.is_absolute() && cb.ends_with(".codebuddy"));
    let qd = qoder_config_dir().expect("home");
    assert!(qd.is_absolute() && qd.ends_with(".qoder"));
    assert_ne!(cb, qd);
}

/// 事实表自洽：`source` 唯一（路由段唯一）。
///
/// **只查 source，不查 file_name**（T10 修正）：file_name 的冲突面是 `(dir, file_name)`
/// 而非全局 —— OMP 与 pi 都叫 `neeko-status.ts`（不同目录）是**正确**的。
/// 此前断言 `file_name` 全局唯一是过度约束，会让合法的「同 API 系 CLI 复用同名文件」
/// 无法接入；而真正的路由冲突（两个 CLI 抢同一 `/hook/{source}`）由本断言拦住。
#[test]
fn hook_targets_have_unique_sources() {
    for (i, a) in HOOK_TARGETS.iter().enumerate() {
        assert!(!a.source.is_empty() && !a.file_name.is_empty());
        for b in HOOK_TARGETS.iter().skip(i + 1) {
            assert_ne!(a.source, b.source, "路由段 source 必须唯一");
        }
    }
    assert!(!HOOK_TARGETS.is_empty());
}

/// **shim 文件名单一源**：需要写 shim 的形态，其 `file_name` 必须等于
/// `config::json::SHIM_MARKER`（「这条命令是不是我们写的」的判据依赖它）。
///
/// # 为什么必须有这条钉子
///
/// 这是**两份字面量**：`SHIM_MARKER = "neeko-status.mjs"`（判据侧）与各行的
/// `file_name`（落盘侧）。它们必须相等，否则：
/// - 判据侧改名前 → 装上去的文件认不出来（报「未安装」）；
/// - 落盘侧改名前 → 判据把自家文件当他人资产（拒绝覆盖/卸载）。
///
/// 历史上这里漂移过一次：判据侧曾多认一个 `neeko-report.mjs`（从不作为 `file_name`
/// 出现），导致「装了但探测说没有」。本用例把两份字面量钉在一起。
///
/// `Standalone` 腿不受此约束（opencode/pi/omp 的文件名是各自扩展机制决定的）。
#[test]
fn shim_bearing_shapes_use_the_canonical_shim_file_name() {
    use crate::agent::hooks::install::config::json::SHIM_MARKER;
    for target in HOOK_TARGETS {
        let needs_shim = target
            .shapes
            .iter()
            .any(|s| !matches!(s, InstallShape::Standalone));
        if !needs_shim {
            continue;
        }
        assert_eq!(
            target.file_name, SHIM_MARKER,
            "{} 需要写 shim，其 file_name 必须等于 SHIM_MARKER（判据与落盘是同一份字面量）",
            target.source
        );
    }
}

/// AC2：claude / codebuddy / qoder **共享同一份** entries 表（不是三份副本）。
///
/// 用指针相等而非内容相等 —— 内容相等无法区分「共享」与「复制了三份恰好一样的内容」，
/// 而后者正是本任务要防的漂移源（改一处忘另两处）。
#[test]
fn claude_compat_sources_share_one_entries_table() {
    let structured_entries = |source: &str| -> &'static [HookEntry] {
        let target = HOOK_TARGETS
            .iter()
            .find(|t| t.source == source)
            .unwrap_or_else(|| panic!("{source} target missing"));
        target
            .shapes
            .iter()
            .find_map(|s| match s {
                InstallShape::Structured { entries, .. } => Some(*entries),
                InstallShape::Standalone | InstallShape::NotifyArgv { .. } => None,
            })
            .unwrap_or_else(|| panic!("{source} must have a Structured face"))
    };
    for source in ["claude", "codebuddy", "qoder"] {
        let got = structured_entries(source);
        assert!(
            std::ptr::eq(got, &CLAUDE_COMPAT_ENTRIES),
            "{source} 必须引用同一份 CLAUDE_COMPAT_ENTRIES（不是副本）: got {:p} len {} vs base {:p} len {}",
            got.as_ptr(), got.len(), CLAUDE_COMPAT_ENTRIES.as_ptr(), CLAUDE_COMPAT_ENTRIES.len()
        );
    }
}

/// AC2 的另一半：三个 Claude 兼容源共用同一份 **shim 模板**（含 Codex 之外的 Structured 行）。
#[test]
fn claude_compat_sources_share_one_shim_template() {
    let templates: Vec<&str> = ["claude", "codebuddy", "qoder"]
        .iter()
        .map(|source| {
            HOOK_TARGETS
                .iter()
                .find(|t| t.source == *source)
                .map(|t| t.template)
                .unwrap_or_else(|| panic!("{source} missing"))
        })
        .collect();
    for t in &templates {
        assert!(
            std::ptr::eq(*t, templates[0]),
            "三源必须共用同一份 shim 模板（同一常量）"
        );
    }
}

/// **AC1 反证钉子**：Codex 必须走 `NotifyArgv`（`config.toml` 的 `notify`），
/// **不是** `Structured { settings_file: "hooks.json" }`。
///
/// 反证：把 Codex 行改回 `Structured { "hooks.json" }`，本用例必红。
/// **Codex 有两条通知面**（2026-10-16 第四轮实测定稿）：
///
/// 1. `notify`（`config.toml` 数组键）→ 轮次完成，**零交互即装即用**；
/// 2. `hooks.json` 的 `CLAUDE_COMPAT_ENTRIES` → 审批/失败，**需用户一次性确认信任**。
///
/// 两者的存在都是**必须**的：
/// - 只留 `notify` → 拿不到审批通知（本用例反证）;
/// - 只留 `hooks.json` → 未信任时**一条都收不到**（连完成的都没有），退化为「装了但没通知」。
///
/// 判据与实测表见 `.trellis/spec/backend/agent-hooks-domain.md`「为什么不能代写信任哈希」。
/// Codex 与 Claude 兼容面同形，故 second face 复用同一份 `CLAUDE_COMPAT_ENTRIES`。
#[test]
fn codex_has_both_notify_and_hooks_json_faces() {
    let codex = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "codex")
        .expect("codex target");

    let notify = codex
        .shapes
        .iter()
        .find_map(|s| match s {
            InstallShape::NotifyArgv {
                config_file, key, ..
            } => Some((*config_file, *key)),
            _ => None,
        })
        .expect("codex 必须有 NotifyArgv 面（完成通知，零交互）");
    assert_eq!(notify, ("config.toml", "notify"));

    let structured = codex
        .shapes
        .iter()
        .find_map(|s| match s {
            InstallShape::Structured {
                settings_file,
                entries,
                ..
            } => Some((*settings_file, *entries)),
            _ => None,
        })
        .expect("codex 必须有 Structured 面（审批通知，需一次确认）");
    assert_eq!(structured.0, "hooks.json", "审批面走 hooks.json");
    assert!(
        std::ptr::eq(structured.1, &CLAUDE_COMPAT_ENTRIES),
        "Codex 的 hooks.json 与 Claude 同形，必须复用同一份 entries（不复制）"
    );

    assert_eq!(
        codex.template.as_ptr(),
        crate::agent::hooks::templates::REPORT_SHIM.as_ptr(),
        "codex 必须复用同一份 shim（AC6）"
    );
}

/// Codex 目录约定（`.codex`）；`CODEX_HOME` 绝对路径优先。
#[test]
fn codex_dir_honors_codex_home_env() {
    let base = tempfile::tempdir().expect("tempdir");
    let _scoped = ScopedEnv::set("CODEX_HOME", base.path());
    assert_eq!(codex_config_dir(), Some(base.path().to_path_buf()));
}

/// 相对 `CODEX_HOME` 视为无效并回落 home（与 XDG / CLAUDE_CONFIG_DIR 同判据）。
#[test]
fn relative_codex_home_falls_back_to_home() {
    let _scoped = ScopedEnv::set("CODEX_HOME", std::path::Path::new("rel/dir"));
    let got = codex_config_dir().expect("home-derived");
    assert!(got.is_absolute() && got.ends_with(".codex"), "got {got:?}");
}

/// U4 回归钉子：`CLAUDE_COMPAT_ENTRIES` **永不**映射 `Notification`。
///
/// 反证：把 `Notification` 行加回来（配 `matcher: "permission_prompt"`），本用例必红。
/// 理由见常量文档 —— matcher 对该事件无效，映射会让所有空闲提示误报为「等待输入」。
#[test]
fn claude_compat_entries_never_map_notification() {
    for entry in &CLAUDE_COMPAT_ENTRIES {
        assert_ne!(
            entry.native_event, "Notification",
            "Notification 的 matcher 不生效，映射会误报（spike U4）"
        );
        assert_ne!(
            entry.native_event, "SessionEnd",
            "SessionEnd 与 Stop 重复，映射会双发"
        );
    }
}

/// 语义覆盖面：Claude 兼容面至少覆盖「等待行动」与「完成」两类
/// （`session_failed` 由 StopFailure 覆盖，`input_requested` 在 Claude 系无对应事件）。
#[test]
fn claude_compat_entries_cover_action_and_completion() {
    let keys: Vec<&str> = CLAUDE_COMPAT_ENTRIES.iter().map(|e| e.event_key).collect();
    for expected in [
        event_keys::APPROVAL_REQUESTED,
        event_keys::TURN_COMPLETED,
        event_keys::SESSION_FAILED,
    ] {
        assert!(keys.contains(&expected), "缺少语义键 {expected}: {keys:?}");
    }
    // matcher 只在需要时声明：PermissionRequest 需要 `*`，Stop/StopFailure 不写该字段。
    let permission = CLAUDE_COMPAT_ENTRIES
        .iter()
        .find(|e| e.native_event == "PermissionRequest")
        .expect("PermissionRequest entry");
    assert_eq!(permission.matcher, Some("*"));
    assert!(CLAUDE_COMPAT_ENTRIES
        .iter()
        .filter(|e| e.native_event != "PermissionRequest")
        .all(|e| e.matcher.is_none()));
}

/// 每个 Structured 面都必须声明配置文件名（否则 writers 无从定位用户配置）。
///
/// 遍历**全部** shape 而非只取 `shapes[0]`：自供源（`dsh`）的 `shapes` 为空数组，
/// 按下标取会 panic；而「一个 CLI 的 Structured 面可能在第二位」（Codex 正是如此）。
#[test]
fn structured_targets_declare_settings_file() {
    for target in HOOK_TARGETS {
        for shape in target.shapes {
            if let InstallShape::Structured {
                settings_file,
                entries,
                ..
            } = shape
            {
                assert!(
                    !settings_file.is_empty(),
                    "{} 缺 settings_file",
                    target.source
                );
                assert!(!entries.is_empty(), "{} 的 entries 不得为空", target.source);
            }
        }
    }
}

/// U1 回归钉子：OMP 变体**不注册** `ui_prompt_start`（OMP 无该事件），
/// 但**保留** `agent_end` 与 `tool_call`（另两条腿）。
///
/// 判据取**注册形态** `onStatus("ui_prompt_start"` 而非裸名 —— 头部注释需要说明
/// 「为何删掉该腿」，裸名判据会把文档也判为违规（承重锚点与非承重文本混同）。
///
/// 注册形态自 2026-11-06 起统一为 `onStatus`（子会话门只此一处，见
/// `templates/tests.rs::templates_gate_child_sessions_at_a_single_registration_point`）。
///
/// 反证：把 OMP 的 template 换回 `PI_TEMPLATE`，本用例必红 —— 届时 OMP 会注册一个
/// 它不认识的事件名（静默无效，但语义上错误）。
#[test]
fn omp_variant_omits_ui_prompt_and_keeps_other_legs() {
    let omp = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "omp")
        .expect("omp target");
    for kept in [
        "onStatus(\"agent_end\"",
        "onStatus(\"tool_call\"",
        "onStatus(\"session_start\"",
        "getSessionName",
        "/hook/omp",
    ] {
        assert!(
            omp.template.contains(kept),
            "OMP 变体缺少 {kept:?}（该腿会静默失效）"
        );
    }
    assert!(
        // 取**注册形态**而非裸名：头部注释必须说明「为何删掉该腿」，裸名判据会把文档
        // 也判为违规（承重锚点与非承重文本混同）。
        !omp.template.contains("onStatus(\"ui_prompt_start\"")
            && !omp.template.contains("pi.on(\"ui_prompt_start\""),
        "OMP 不支持 ui_prompt_start（spike U1），变体不得注册它"
    );
    assert!(
        // 与 pi 的模板常量**不是同一份**（独立变体）。
        // 用 pi 行的 template 指针比对，而非直接引用 data.rs 的私有常量。
        !std::ptr::eq(
            omp.template,
            HOOK_TARGETS
                .iter()
                .find(|t| t.source == "pi")
                .expect("pi target")
                .template
        ),
        "OMP 必须是独立变体（不能复用 pi 的同一常量）"
    );
}

/// 模板契约锚点：OMP 变体与 pi 模板同源的硬约束（坐标扫描 / fan-out / token / loopback /
/// 主题上报 / 永不非零退出）。
#[test]
fn omp_template_keeps_shared_contract_anchors() {
    use crate::agent::hooks::ingest::endpoint;
    use crate::agent::hooks::ingest::validation;
    let omp = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "omp")
        .expect("omp target");
    for anchor in [
        endpoint::ENDPOINTS_DIR_NAME,
        "readdirSync",
        "Promise.allSettled",
        endpoint::ENV_KEY_PORT,
        endpoint::ENV_KEY_TOKEN,
        validation::TOKEN_HEADER,
        "127.0.0.1",
        "title:",
    ] {
        assert!(
            omp.template.contains(anchor),
            "OMP 模板缺少契约锚点 {anchor:?}"
        );
    }
}

/// **自供源**：不需要 Neeko 安装、但仍在 ingest 白名单里的源（`shapes` 为空）。
///
/// 存在理由：`HOOK_TARGETS` 同时驱动两件事 —— ①`/hook/{source}` 的**接收白名单**；
/// ②设置页的**「Neeko 能装哪些 CLI」**。DSH 只满足前者：它的上报由
/// `packages/dsh-neeko`（DSH 自己的插件）完成，Neeko 既不该也不需要在用户的
/// profile 里写文件。
///
/// 若把 DSH 建模成一个「有 shapes 但 dir 恒 None」的行，设置页会多出一行
/// 「dsh — not installed」+ 一个拨动无效果的开关（`CliHooksSection` 的
/// `hookStatus.map` 是无条件渲染）。
///
/// 故 `shapes` 为空 = **自供源的唯一标记**，且必须显式声明（不是「忘了填」）。
#[test]
fn self_supplied_sources_are_not_installable() {
    let self_supplied: Vec<&str> = HOOK_TARGETS
        .iter()
        .filter(|t| t.shapes.is_empty())
        .map(|t| t.source)
        .collect();
    // 当前只有 DSH 是自供源；新增时必须在这里登记（否则说明有人漏填 shapes）。
    assert_eq!(
        self_supplied,
        ["dsh"],
        "自供源清单变了 —— 新增自供源要同步：①本断言 ②设置页过滤 ③文档"
    );
}

/// 自供源仍必须在接收白名单里（否则它的上报会被 `hook_source` 静默丢弃）。
#[test]
fn self_supplied_sources_are_still_accepted_by_ingest() {
    let source = "dsh";
    assert!(
        HOOK_TARGETS.iter().any(|t| t.source == source),
        "{source} 必须在 HOOK_TARGETS 里（否则 /hook/{source} 会被白名单丢掉）"
    );
}

/// **不是每个 target 都要能被安装** —— 但每个 target 都必须能定位到自己该看的地方。
///
/// 自供源的 `dir` 恒 `None`（Neeko 不去任何目录写东西）；其余源的 `dir` 必须可解析
/// （解析不到 = 该 CLI 本机未安装，那是运行时事实，不是数据错误）。
#[test]
fn self_supplied_sources_have_no_directory() {
    for target in HOOK_TARGETS.iter().filter(|t| t.shapes.is_empty()) {
        assert!(
            (target.dir)().is_none(),
            "{} 是自供源，不该去任何用户目录（dir 必须恒 None）",
            target.source
        );
    }
}
