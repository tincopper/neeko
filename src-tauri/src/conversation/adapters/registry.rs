//! Adapter registry — the single place that decides which native session
//! formats History can read.
//!
//! Kept out of `adapters/mod.rs` on purpose (红线 9：`mod.rs` 只做声明与 re-export)：
//! 「有哪些适配器」是一条业务事实，值得单独一个文件承载，也让新增 agent 的落点明确。

use crate::conversation::adapter::AgentSessionAdapter;

use super::{
    ClaudeCodeAdapter, CodeBuddyAdapter, CodexAdapter, GeminiAdapter, GrokAdapter, OmpAdapter,
    OpenCodeAdapter, PiAdapter, QoderAdapter, ReasonixAdapter,
};

/// 返回所有已注册的 AgentSessionAdapter 实例
#[must_use]
pub fn all_adapters() -> Vec<Box<dyn AgentSessionAdapter>> {
    vec![
        Box::new(CodexAdapter),
        Box::new(ClaudeCodeAdapter),
        Box::new(PiAdapter),
        Box::new(GeminiAdapter),
        Box::new(QoderAdapter),
        Box::new(CodeBuddyAdapter),
        Box::new(OpenCodeAdapter),
        Box::new(OmpAdapter::new()),
        Box::new(GrokAdapter),
        Box::new(ReasonixAdapter),
    ]
}

#[cfg(test)]
mod tests {
    use super::all_adapters;
    use crate::agent::AgentManager;
    use crate::conversation::adapter::{is_owned_path, SessionDeleteSupport};
    use std::path::PathBuf;

    /// L2: every history adapter agent_id must exist in default AgentConfig ids.
    #[test]
    fn should_align_history_adapter_ids_with_default_agents() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        let agent_ids: std::collections::HashSet<&str> =
            agents.iter().map(|a| a.id.as_str()).collect();

        for adapter in all_adapters() {
            let id = adapter.agent_id();
            assert!(
                agent_ids.contains(id),
                "history adapter `{id}` has no matching AgentConfig in default_agents"
            );
        }
    }

    #[test]
    fn should_register_omp_grok_reasonix_adapters() {
        let adapters = all_adapters();
        let ids: Vec<&str> = adapters.iter().map(|a| a.agent_id()).collect();
        for expected in [
            "omp",
            "grok",
            "reasonix",
            "codex",
            "pi",
            "claude-code",
            "opencode",
        ] {
            assert!(
                ids.contains(&expected),
                "missing adapter {expected} in all_adapters: {ids:?}"
            );
        }
    }

    /// 删除能力的**声明台账**：注册表里每个 adapter 都必须在这里表态。
    ///
    /// 为什么是「集合相等」而不是「逐条覆盖」：新增 adapter 时忘了表态 → 本用例红
    ///（集合多了一个 id），迫使作者当场决定 `Native` / `Storage` / `Unsupported`，
    /// 而不是让 trait 默认值 `Unsupported` 静默背锅（= 某个 agent 悄悄没有删除入口）。
    ///
    /// 变异验证：给任一 adapter 改错状态（如 qoder → Native）或新增一个未登记的
    /// adapter → 本用例红。
    #[test]
    fn should_declare_delete_support_for_every_registered_adapter() {
        use SessionDeleteSupport::{Native, Storage, Unsupported};

        let expected: &[(&str, SessionDeleteSupport)] = &[
            // 委派 CLI：CLI 维护的就是 Neeko 列出的那处存储。
            ("codex", Native),
            ("opencode", Native),
            // 删存储单元（无官方命令，或命令删的不是这条）。
            ("claude-code", Storage),
            ("pi", Storage),
            ("gemini", Storage),
            ("qoder", Storage),
            ("omp", Storage),
            ("grok", Storage),
            ("reasonix", Storage),
            // 未实测到安全删除单元 → 不提供入口（fail-closed）。
            ("codebuddy", Unsupported),
        ];

        let adapters = all_adapters();
        let mut actual: Vec<(String, SessionDeleteSupport)> = adapters
            .iter()
            .map(|a| (a.agent_id().to_string(), a.delete_support()))
            .collect();
        actual.sort_by(|a, b| a.0.cmp(&b.0));

        let mut want: Vec<(String, SessionDeleteSupport)> = expected
            .iter()
            .map(|(id, s)| ((*id).to_string(), *s))
            .collect();
        want.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(
            actual, want,
            "delete support table drifted from all_adapters(); 新增 adapter 必须在此表态"
        );
    }

    /// 自洽性护栏（同 `capability_probe` 的判据）：
    /// `Native ⇒ delete_command 非空`、`Storage ⇒ delete_targets 非空且全部在 session_root 内`。
    ///
    /// 任一条不成立就是「声明了没人实现」（红线 14 的形态）：入口在、点了要么报错，
    /// 要么删到 session_root 之外（缓存被污染时就是任意文件删除）。
    ///
    /// 变异验证：
    /// - 把 codex 的 `delete_command` 改成 `None` → 红；
    /// - 把 grok 的 `delete_targets` 改成返回空 Vec → 红；
    /// - 把某个 `Storage` adapter 的 targets 改成 `session_root().parent()` → 红。
    #[test]
    fn should_keep_each_adapters_delete_capability_self_consistent() {
        for adapter in all_adapters() {
            let id = adapter.agent_id();
            let root = adapter.session_root();
            // 探针路径：不真的读盘，只用来问「你会删什么」。
            let file = root.join("neeko-delete-probe").join("session.jsonl");

            match adapter.delete_support() {
                SessionDeleteSupport::Native => {
                    let argv = adapter
                        .delete_command("probe-session-id", Some("/probe/project"), &file)
                        .unwrap_or_else(|| {
                            panic!("{id}: delete_support() == Native but delete_command() is None")
                        });
                    assert!(
                        !argv.is_empty(),
                        "{id}: Native delete_command must contain the executable name"
                    );
                    assert!(
                        argv[1..].iter().any(|a| a == "probe-session-id"),
                        "{id}: Native delete_command must address the session: {argv:?}"
                    );
                }
                SessionDeleteSupport::Storage => {
                    let targets = adapter.delete_targets(&file, "probe-session-id");
                    assert!(
                        !targets.is_empty(),
                        "{id}: Storage delete_support but delete_targets() is empty"
                    );
                    for target in targets {
                        assert!(
                            is_owned_path(&target, &root),
                            "{id}: delete target {} escapes session_root {}",
                            target.display(),
                            root.display()
                        );
                    }
                }
                SessionDeleteSupport::Unsupported => {}
            }
        }
    }

    /// 单文件 agent 的删除单元就是会话文件本身；目录 / 文件对 agent 的单元更大。
    ///
    /// 变异验证：把 grok 的 `delete_targets` 改回默认单文件 → 第一条红；
    /// 把 reasonix 改成默认 → 第二条红。
    #[test]
    fn should_derive_delete_unit_from_storage_shape() {
        let adapters = all_adapters();
        let find = |id: &str| -> &dyn crate::conversation::adapter::AgentSessionAdapter {
            adapters
                .iter()
                .find(|a| a.agent_id() == id)
                .map(std::convert::AsRef::as_ref)
                .unwrap_or_else(|| panic!("adapter {id} missing"))
        };

        // grok：会话是**目录**（summary.json + updates.jsonl）。
        let grok = find("grok");
        let grok_root = grok.session_root().join("-proj").join("session-uuid");
        let grok_targets = grok.delete_targets(&grok_root.join("summary.json"), "session-uuid");
        assert_eq!(grok_targets, vec![grok_root.clone()]);

        // reasonix：主 jsonl + 兄弟 events + meta。
        let rx = find("reasonix");
        let rx_dir = rx.session_root().join("-proj").join("sessions");
        let rx_targets = rx.delete_targets(&rx_dir.join("20260101-abc.jsonl"), "20260101-abc");
        assert_eq!(
            rx_targets,
            vec![
                rx_dir.join("20260101-abc.jsonl"),
                rx_dir.join("20260101-abc.events.jsonl"),
                rx_dir.join("20260101-abc.jsonl.meta"),
            ]
        );

        // 默认单文件：pi / claude。
        for id in ["pi", "claude-code"] {
            let adapter = find(id);
            let file: PathBuf = adapter.session_root().join("p").join("s.jsonl");
            assert_eq!(
                adapter.delete_targets(&file, "s"),
                vec![file],
                "{id} should delete exactly the session file"
            );
        }
    }
}
