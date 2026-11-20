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

/// `agent_id` → 「续接这个原生会话」的 argv **片段**（`None` = 该 CLI 没有可用的续接形态）。
///
/// 返回的是**紧跟 program 之后**的参数片段，不含程序名：resume 语法是 per-CLI 事实，
/// 只能来自适配器（红线 15），而「放在启动行的哪个位置」由团队执行层决定
/// (`agent::team::execution::plan_member_spawn` 是唯一组合点)。
///
/// 2026-11-11 实测（`<cli> --help` / `<cli> resume --help`）：
///
/// | CLI | 片段 | 形态 |
/// | --- | --- | --- |
/// | claude-code / codebuddy / grok | `--resume <id>` | 全局 flag |
/// | codex | `resume <id>` | **子命令**（必须紧跟 program，追加到末尾会被当成 PROMPT）|
/// | pi / opencode | `--session <id>` | 全局 flag |
/// | omp | `--resume=<id>` | flag=值 |
/// | reasonix | `--dir <path> --resume=<id>` | 全局 flag（按项目目录定位）|
/// | qoder / gemini | — | qoder 只在 `--print` 下有效、gemini 无 resume ⇒ `None` |
///
/// # 两个读者
///
/// ① 团队执行层拼启动 argv（传成员的真实工程路径）；
/// ② `agent::team::view` 只回答「这个成员还回不回得来」（传空 `project_path`，
///    只判 `is_some()`）—— 两处问的是同一个事实，所以只有这一个函数。
#[must_use]
pub fn resume_argv_for(
    agent_id: &str,
    native_session_id: &str,
    project_path: &str,
) -> Option<Vec<String>> {
    all_adapters()
        .into_iter()
        .find(|adapter| adapter.agent_id() == agent_id)
        .and_then(|adapter| adapter.resume_command(native_session_id, project_path))
}

#[cfg(test)]
mod tests {
    use super::{all_adapters, resume_argv_for};
    use crate::agent::AgentManager;
    use crate::conversation::adapter::{is_owned_path, SessionDeleteSupport};
    use std::path::PathBuf;

    /// **2026-11-11 实测台账**：每个已准入 CLI 的续接片段（`None` = 没有可用的续接形态）。
    ///
    /// 为什么覆盖 [`crate::agent::team::admission::ADMISSIONS`] **全表**而不是只列能当
    /// 成员的几家：新增一行准入数据时本用例会红，作者必须当场回答「这个 CLI 能不能
    /// 续接原来的会话」—— 而不是让它默认落进 `None`（= 团队恢复时被静默判成「只能新开」）。
    ///
    /// codex 那一行是 AC-6 的机器形式：`resume` 是**子命令**，必须 `["resume", id]`
    /// 紧跟 program；写成 `[id, "resume"]` 或追加到末尾都会被它当成 PROMPT。
    #[test]
    fn the_resume_fragment_of_every_admissible_cli_is_the_smoke_tested_one() {
        let expected: &[(&str, Option<&[&str]>)] = &[
            ("claude-code", Some(&["--resume", "s1"])),
            ("codebuddy", Some(&["--resume", "s1"])),
            ("codex", Some(&["resume", "s1"])),
            // gemini 无 resume；qoder 的 `-r/--resume` 只在 `--print` 下有效。
            ("gemini", None),
            ("grok", Some(&["--resume", "s1"])),
            ("omp", Some(&["--resume=s1"])),
            ("opencode", Some(&["--session", "s1"])),
            ("pi", Some(&["--session", "s1"])),
            ("qoder", None),
            // reasonix 按项目目录定位会话 ⇒ `--dir` 也在片段里。
            ("reasonix", Some(&["--dir", "/proj", "--resume=s1"])),
        ];

        // 集合相等：漏一行 = 本用例红（与删除能力台账同一形态）。
        let mut declared: Vec<&str> = expected.iter().map(|(id, _)| *id).collect();
        declared.sort_unstable();
        let mut admitted = crate::agent::team::admission::admitted_agent_ids();
        admitted.sort();
        assert_eq!(
            declared,
            admitted.iter().map(String::as_str).collect::<Vec<_>>(),
            "续接台账与准入表漂了：新增 CLI 必须在此表态能不能续接"
        );

        for (agent_id, fragment) in expected {
            let actual = resume_argv_for(agent_id, "s1", "/proj");
            let want = fragment.map(|args| {
                args.iter()
                    .map(|arg| (*arg).to_string())
                    .collect::<Vec<_>>()
            });
            assert_eq!(
                actual, want,
                "{agent_id} 的续接片段与 2026-11-11 实测不符（改之前先重跑 `<cli> --help`）"
            );
        }
    }

    /// 片段里**只有参数**，没有程序名：拼装载体的位置只有一个
    /// （`agent::team::execution::plan_member_spawn`），它会在前面自己放 program。
    ///
    /// 反例（本用例挡的正是它）：某个 adapter 图省事返回完整命令行 ⇒ 团队启动行里
    /// 会多出一个可执行文件，症状是「起得来但参数全错」。
    #[test]
    fn a_resume_fragment_never_contains_the_program_name() {
        const EXECUTABLES: &[&str] = &[
            "claude",
            "codex",
            "pi",
            "gemini",
            "qoder",
            "opencode",
            "grok",
            "omp",
            "codebuddy",
            "reasonix",
        ];
        for agent_id in crate::agent::team::admission::admitted_agent_ids() {
            let Some(fragment) = resume_argv_for(&agent_id, "s1", "/proj") else {
                continue;
            };
            for arg in &fragment {
                assert!(
                    !EXECUTABLES.contains(&arg.as_str()),
                    "{agent_id}: 片段里出现了程序名 `{arg}`（只允许参数）：{fragment:?}"
                );
                assert_ne!(
                    &agent_id, arg,
                    "{agent_id}: 片段里出现了自己的 id：{fragment:?}"
                );
            }
        }
    }

    /// 未知 id ⇒ `None`（不 panic）：可恢复性是**派生**字段，未知 CLI 只该得到「不能续接」。
    #[test]
    fn an_unknown_agent_id_has_no_resume_fragment() {
        assert_eq!(resume_argv_for("not-a-cli", "s1", "/proj"), None);
    }

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
        use SessionDeleteSupport::{Native, Storage};

        let expected: &[(&str, SessionDeleteSupport)] = &[
            // 委派 CLI：CLI 维护的就是 Neeko 列出的那处存储。
            ("codex", Native),
            ("opencode", Native),
            // 删存储单元（无官方命令，或命令删的不是这条）。
            ("claude-code", Storage),
            ("pi", Storage),
            ("gemini", Storage),
            ("qoder", Storage),
            ("codebuddy", Storage),
            ("omp", Storage),
            ("grok", Storage),
            ("reasonix", Storage),
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

    /// **真实样本探针**：三方实测落盘各存一份（截断正文、保留形态），断言仍然解析出
    /// 人类可读的标题。
    ///
    /// 这是唯一能抓住「CLI 改了存储布局」的机器判据 —— 我们自己写的合成夹具会连同
    /// 假设一起通过（qoder / codebuddy 就是这样在测试全绿的情况下静默丢了标题）。
    ///
    /// 断言口径遵循 `unit-test/real-source-determinism.md`：只断言「存在一条真标题」
    /// （`≥`），不断言标题的具体文字（那是 CLI 的产出，会随模型变化）。
    #[test]
    fn real_transcripts_still_resolve_a_human_title() {
        use crate::conversation::manager::resolve_title;

        let cases: &[(&str, &str)] = &[
            ("qoder", include_str!("fixtures/qoder-real.jsonl")),
            ("codebuddy", include_str!("fixtures/codebuddy-real.jsonl")),
            ("claude-code", include_str!("fixtures/claude-real.jsonl")),
        ];

        for (agent_id, sample) in cases {
            // 夹具路径由 tempdir 推导（红线 13）
            let dir = tempfile::TempDir::new().expect("tempdir");
            let path = dir.path().join("session.jsonl");
            std::fs::write(&path, sample).expect("write fixture");

            let adapter = all_adapters()
                .into_iter()
                .find(|a| a.agent_id() == *agent_id)
                .unwrap_or_else(|| panic!("{agent_id} 未注册"));
            let meta = adapter
                .parse_meta(&path)
                .unwrap_or_else(|e| panic!("{agent_id} 解析真实样本失败: {e:#}"));

            let title = resolve_title(&meta.title_candidates(), agent_id, &meta.native_session_id);
            let fallback_prefix = format!("{agent_id} ");
            assert!(
                !title.starts_with(&fallback_prefix),
                "{agent_id} 退化成兜底串（说明真实布局又漂了）: {title:?}"
            );
            assert!(
                !title.contains("local-command") && !title.contains("system-reminder"),
                "{agent_id} 把 harness 注入当成了标题: {title:?}"
            );
        }
    }

    /// 身份脊柱护栏：**每个注册的 adapter 都必须在 `common::agent::descriptor` 里有一行**，
    /// 且转录根与 glob 都非空。
    ///
    /// 为什么是「没表态就红」而不是运行时兜底：路径事实缺失时的表现是「扫到 0 个会话」——
    /// 一个合法结果，没人会发现（qoder 曾这样静默丢了全部历史）。这里把「声明缺失」
    /// 变成编译期后第一步就能看见的红灯，与删除能力台账同一个形态。
    #[test]
    fn every_adapter_has_a_descriptor_row() {
        for adapter in all_adapters() {
            let id = adapter.agent_id();
            assert!(
                crate::common::agent::descriptor::descriptor(id).is_some(),
                "{id} 缺少 descriptor 行（见 common/agent/descriptor.rs 的 AGENTS 表）"
            );
            assert!(
                !adapter.file_pattern().is_empty(),
                "{id} 的 file_pattern 为空（descriptor 未声明 pattern？）"
            );
            assert!(
                !adapter.session_root().as_os_str().is_empty(),
                "{id} 的 session_root 为空（descriptor 未声明转录根？）"
            );
        }
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
