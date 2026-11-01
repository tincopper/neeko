//! 逐 CLI hook 开关的配置面（agent 域；父任务 design R2.6 / 本任务 design §10）。
//!
//! **为什么不在 `NotificationSettings`**：`{"claude": true}` 这类**业务身份**属于业务域知识
//! —— 写进 `src-tauri/src/notification/` 会让核心域出现 CLI 名字（父任务 T4 禁止的形态），
//! 且与父任务 AC1「核心域 diff 为空」直接冲突（`cli_hooks` 字段就住在那里）。
//! 既有先例一致：`agent/boot.rs` 已自有 `customAgents` 配置键。
//!
//! **两个开关的分工**（设计意图，非重复）：
//! - `NotificationSettings.cli_hooks`（核心域，**主开关**）：「Neeko 可为 CLI 安装状态上报 hook」。
//!   默认 `false` = 用户未显式同意 ⇒ 一个都不装（满足 R2.6 的默认关）。
//! - 本模块的 `agentHookSources`（agent 域，**逐 CLI 覆盖**）：只在需要「装大部分、
//!   单独关掉某一个」时才有差异项；键缺失 ⇒ 跟随主开关。
//!
//! 生效判定：`effective(cli) = master && sources.get(cli).unwrap_or(true)`。

use std::collections::HashMap;

/// 配置键：逐 CLI 的 hook 开关覆盖（`{"claude": false}`）。
const AGENT_HOOK_SOURCES_KEY: &str = "agentHookSources";

/// 读 `config.json` 的逐 CLI 覆盖表。
///
/// 容忍一切畸形：非对象 / 值非布尔 / 键非字符串 → 忽略该项（回「跟随主开关」）。
/// 与 `StorageManager::notification_settings` 同源的「损坏回默认」哲学 ——
/// 手改配置不得让 hook 安装行为进入未定义态。
#[must_use]
pub fn hook_source_overrides(config: &serde_json::Value) -> HashMap<String, bool> {
    config
        .get(AGENT_HOOK_SOURCES_KEY)
        .and_then(serde_json::Value::as_object)
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_bool().map(|b| (k.clone(), b)))
                .collect()
        })
        .unwrap_or_default()
}

/// 某 CLI 的 hook 是否应处于安装态。
///
/// `master` = 用户级主开关（`NotificationSettings.cli_hooks`）；
/// `overrides` = 逐 CLI 覆盖。缺失项跟随主开关（默认启用）。
#[must_use]
pub fn hook_enabled_for(source: &str, master: bool, overrides: &HashMap<String, bool>) -> bool {
    master && overrides.get(source).copied().unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overrides(pairs: &[(&str, bool)]) -> HashMap<String, bool> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), *v)).collect()
    }

    /// 主开关关 → 一律不装；覆盖为 `true` 也不能绕过（R2.6 默认关的判据）。
    #[test]
    fn master_off_disables_everything() {
        let ov = overrides(&[("claude", true)]);
        for source in ["claude", "qoder", "pi"] {
            assert!(!hook_enabled_for(source, false, &ov), "{source}");
        }
    }

    /// 主开关开 + 无覆盖项 → 全部启用（与 `10-12` 的「开则全装」向后兼容）。
    /// 逐 CLI 覆盖：单独关掉一个，其余不受影响（R2.6 的核心诉求）。
    ///
    /// 两组合并成一个用例：判据是同一个纯函数 `hook_enabled_for`，
    /// 拆开只是重复调用同一表达式（此前另有一个 `enabled_sources` 聚合函数，
    /// 无生产调用者、且其语义在前端又实现了一遍 —— 已删除）。
    #[test]
    fn master_on_defaults_all_and_per_cli_override_excludes_only_one() {
        assert!(hook_enabled_for("claude", true, &HashMap::new()));
        let ov = overrides(&[("claude", false)]);
        assert!(!hook_enabled_for("claude", true, &ov));
        assert!(hook_enabled_for("qoder", true, &ov));
        assert!(hook_enabled_for("pi", true, &ov));
    }

    /// 覆盖为 `true` 不等于绕过主开关（主开关是闸门，覆盖只能在其内细分）。
    #[test]
    fn override_true_does_not_bypass_master() {
        let ov = overrides(&[("claude", true)]);
        assert!(!hook_enabled_for("claude", false, &ov));
    }

    /// 畸形配置容忍：非对象 / 值非布尔 / 混合 → 只取可判定项，其余回默认。
    #[test]
    fn malformed_overrides_are_tolerated() {
        assert!(hook_source_overrides(&serde_json::json!("nope")).is_empty());
        assert!(hook_source_overrides(&serde_json::json!([])).is_empty());
        assert!(hook_source_overrides(&serde_json::json!({})).is_empty());

        let mixed = serde_json::json!({
            "agentHookSources": { "claude": false, "qoder": "yes", "pi": true, "n": 1 }
        });
        let got = hook_source_overrides(&mixed);
        assert_eq!(got.get("claude"), Some(&false));
        assert_eq!(got.get("pi"), Some(&true));
        assert_eq!(got.get("qoder"), None, "非布尔值必须被忽略");
        assert_eq!(got.get("n"), None, "非布尔值必须被忽略");
    }

    /// **跨语言常量单一源**：`config.json` 的键名在前端（TS 写盘）与后端（Rust 读盘）
    /// 各有一份字面量 —— 任一侧改名都会让逐 CLI 覆盖**静默失效**（回退「全跟随主开关」，
    /// 无报错、无 UI 提示）。
    ///
    /// 本仓库对这类跨语言常量的既有做法是 `include_str!` 钉死（见
    /// `notification/dispatch.rs` 的事件名镜像、`agent/hooks/install/outcome.rs` 的类型镜像）。
    /// 反证：改任一侧的键名字面量，本用例必红。
    #[test]
    fn config_key_is_mirrored_in_frontend() {
        // 前端该键的**唯一**声明点是 shared 模块（设置页与侧栏提示共用一份判定，
        // 见 `shared/utils/agentHookSources.ts` 的模块注释）。断言锁在这里而不是某个
        // 组件上：组件只是消费者，锁消费方会让「多一个消费者」变成一次假红。
        const FRONTEND: &str =
            include_str!("../../../../../../src/shared/utils/agentHookSources.ts");
        assert!(
            FRONTEND.contains(&format!("'{AGENT_HOOK_SOURCES_KEY}'"))
                || FRONTEND.contains(&format!("\"{AGENT_HOOK_SOURCES_KEY}\"")),
            "前端 shared/utils/agentHookSources.ts 必须使用同一个 config 键 \
             {AGENT_HOOK_SOURCES_KEY:?}（改一端必须同步另一端）"
        );
    }

    /// 键缺失 ⇒ 跟随主开关（不是「默认关」—— 那会让主开关开而什么都不装）。
    #[test]
    fn absent_key_follows_master() {
        let ov = hook_source_overrides(&serde_json::json!({ "other": 1 }));
        assert!(hook_enabled_for("claude", true, &ov));
        assert!(!hook_enabled_for("claude", false, &ov));
    }
}
