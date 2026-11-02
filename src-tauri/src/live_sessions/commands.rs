//! live-sessions IPC：快照 + long-poll 版本等待（命令层极薄，红线 6）。

use std::time::Duration;

use tauri::State;

use crate::live_sessions::entry::TitleSource;
use crate::live_sessions::events::emit_changed;
use crate::live_sessions::registry::Registry;
use crate::live_sessions::view::{LiveSessionsSnapshot, LiveSessionsWait};
use crate::{AppError, AppStateWrapper};

/// 长轮询默认挂起时长（前端 25s 续挂；后端上限内自兜底）。
const WAIT_TIMEOUT_DEFAULT_MS: u64 = 25_000;
/// 后端允许的最短挂起（低于它等价于空转轮询）。
const WAIT_TIMEOUT_MIN: Duration = Duration::from_secs(1);
/// 后端允许的最长挂起（与 `terminal_drain_wait` 同为 30s 上限）。
const WAIT_TIMEOUT_MAX: Duration = Duration::from_secs(30);

/// 把请求的挂起时长钳制进允许区间（纯函数，便于单测）。
///
/// `None` / `Some(0)` = 用默认值：前端把「没想法」和「立刻返回」混为一谈时，
/// 默认值必须是一个**有用的**挂起时长（否则退化成忙循环）。
#[must_use]
fn clamp_wait_timeout(timeout_ms: Option<u64>) -> Duration {
    let requested = match timeout_ms {
        Some(ms) if ms > 0 => ms,
        _ => WAIT_TIMEOUT_DEFAULT_MS,
    };
    Duration::from_millis(requested).clamp(WAIT_TIMEOUT_MIN, WAIT_TIMEOUT_MAX)
}

/// 列出 live session 快照（**全量**，不分单元）。
///
/// 快照要同时服务三种视图（侧栏按单元 / tab 标题 / 连接页），各视图的分组口径不同；
/// 后端只交出一份完整、稳定排序的快照，按 `workspaceKey` 等值的分组由前端 selector 完成。
/// 曾经的 `workspace: Option<WorkspaceSession>` 参数从未被调用方使用，却让这里多出一套
/// 与前端并行的「单元归属」判据（`UnitScope::owns` 按 cwd 最深根 vs 前端按 key 等值）——
/// 两套判据迟早对不上，故删除。
#[tauri::command]
pub async fn list_live_sessions(
    state: State<'_, AppStateWrapper>,
) -> Result<LiveSessionsSnapshot, AppError> {
    Ok(state.live_sessions.snapshot_view())
}

/// 版本未变则挂起，直到注册表版本变化或超时（credit-pull：不推全量快照）。
///
/// 返回 `changed: false` 表示「这段时间没有任何变更」—— 前端据此续挂，**不得**当成
/// 数据到达（那会让空闲期每 25s 重拉一次快照）。
#[tauri::command]
pub async fn wait_live_sessions(
    since: u64,
    timeout_ms: Option<u64>,
    state: State<'_, AppStateWrapper>,
) -> Result<LiveSessionsWait, AppError> {
    let timeout = clamp_wait_timeout(timeout_ms);
    let version = state.live_sessions.wait_for_change(since, timeout).await;
    Ok(LiveSessionsWait {
        version,
        changed: version != since,
    })
}

/// 回传会话标题 / 用户提交：CLI 自报的 `source = native`，或终端用户的每次提交
/// （`source = prompt`）。
///
/// **为什么是一条命令而不是新的前端→后端事件**：既有前端→后端通道只有
/// `terminal-input-{id}`（载荷是 stdin 字节）与 agent chat 事件（后端→前端），
/// 复用前者会把标题塞进 stdin 流、复用后者方向不对 —— 两者都得新造一条通道名，
/// 那正是红线 5 要消灭的形态。
///
/// **为什么用户输入也走这里而不是再加一条命令**：安装态的旧构建里多一个命令名没有意义
/// （漏注册时前端只会拿到一个被吞掉的 invoke 错误），而标题本来就是同一个事实
/// 「这条会话叫什么」，只是来源不同 —— 差异用 `source` 表达，不用再开一条通道。
///
/// # 语义
///
/// - `source = prompt`（用户提交）⇒ 首次无真标题时按 `Prompt` 命名并标记「用户已在用」；
///   后续提交只清除 CLI hook 的权威状态门，不重复改名；
/// - `source = native`（CLI 自报）⇒ 只升级标题。
///
/// 空白 `Prompt` 仍是一次用户提交（清除权威状态门），但不会写入空标题；
/// 空白 `Native` 什么都不发生。`Result` 是 IPC 契约而不是当下的错误分支（前端 `invoke<boolean>`
/// 依赖它，且失败形状已经存在：锁中毒 / 将来加校验），不从契约面上抹掉。
#[allow(clippy::unnecessary_wraps)] // 同上：返回形状是契约，不是实际错误路径
#[tauri::command]
pub fn set_live_session_title(
    session_id: String,
    title: String,
    source: Option<TitleSource>,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<bool, AppError> {
    let origin = source.unwrap_or(TitleSource::Native);
    let changed = apply_title(&state.live_sessions, &session_id, &title, origin);
    if changed {
        // 与其它生产者（chat 合帧 emit / PTY 注册与退出 / hook 投影）同口径：版本真的变了就
        // 通知一次（载荷只有版本号）。
        emit_changed(&app_handle, state.live_sessions.version());
    }
    Ok(changed)
}

/// 恢复成功后，让新会话**继承**旧会话的身份并让旧条目退场。
///
/// 关 tab 只把条目标成 `Stopped`（见 `wiring::pty::close_and_notify`），于是侧栏仍留着
/// 「点回来」的入口。用户点回来后，新 PTY 是那条会话的**延续**：
///
/// - 不继承 ⇒ 新会话要等用户敲第一条输入才会被列出，表现是「点了恢复，那一行反而消失了」；
/// - 不退场 ⇒ 侧栏同时挂着「已停止」与「新会话」两行。
///
/// 语义全在 [`Registry::adopt`]：只接受**终止态**的 `from`，且只搬 `into` 缺的字段。
#[tauri::command]
pub fn adopt_live_session(
    from_session_id: String,
    into_session_id: String,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> bool {
    let adopted = state
        .live_sessions
        .adopt(&from_session_id, &into_session_id);
    if adopted {
        emit_changed(&app_handle, state.live_sessions.version());
    }
    adopted
}

/// 这条会话的**原生恢复命令**（`["--resume", "<native id>"]` 这类）；`None` = 不支持。
///
/// 点击侧栏会话行、需要重建 tab 时调用：拿到的 args 由前端拼进 `taskCommand`，于是新建的
/// 终端是**续写**而不是重开（与 Histor 面板的恢复路径同形）。
///
/// 判据全在后端，前端不维护能力表：
/// - `native_session_id` 只来自 CLI hook（neeko 自己的 `session_id` 对 CLI 无意义，
///   拼不出 `--resume`）；
/// - 「这个 agent 支不支持原生恢复」由 adapter 回答；
/// - 无 hook 的会话（或需要 file path 的 adapter）返回 `None` —— 前端退回「新建一个同
///   agent 的终端」，不猜。
#[tauri::command]
pub fn live_session_resume_command(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Option<Vec<String>> {
    let entry = state.live_sessions.entry(&session_id)?;
    let agent_id = entry.agent_id?;
    let native_session_id = entry.native_session_id?;
    state
        .conversation_manager
        .resume_command_for_native(&agent_id, &native_session_id, &entry.cwd)
}

/// 标题上报的**唯一**决策（`source` 决定是否顺带把会话标成「在用」）。
///
/// 抽成自由函数以便直测（不需要 Tauri 运行时）—— `Native` 与 `Prompt` 的差别只能靠
/// 「同级可覆盖 / 弱级被拒」的用例区分，断言最终标题值本身区分不了。
///
/// 用户提交走 `Registry::report_user_input`（标题 + 可见性 + 清权威门一次加锁）；
/// 其余来源走 `Registry::set_title` 的纯标题路径。空白已由 `title::admit` 判负，
/// 这里不再重复检查。准入与升级规则仍只有一份实现。
fn apply_title(registry: &Registry, session_id: &str, title: &str, source: TitleSource) -> bool {
    match source {
        // 用户提交 = 可能首次命名，也可能只是后续输入（清除权威状态门）。
        // 两者必须共用一次加锁，不能拆成「先查标题、再写状态」。
        TitleSource::Prompt => registry.report_user_input(session_id, title),
        _ => registry.set_title(session_id, source, title),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_defaults_to_25_seconds() {
        assert_eq!(clamp_wait_timeout(None), Duration::from_millis(25_000));
        assert_eq!(clamp_wait_timeout(Some(0)), Duration::from_millis(25_000));
    }

    #[test]
    fn timeout_is_clamped_into_the_allowed_range() {
        assert_eq!(clamp_wait_timeout(Some(500)), WAIT_TIMEOUT_MIN);
        assert_eq!(clamp_wait_timeout(Some(5_000)), Duration::from_secs(5));
        assert_eq!(clamp_wait_timeout(Some(60_000)), WAIT_TIMEOUT_MAX);
        assert_eq!(clamp_wait_timeout(Some(u64::MAX)), WAIT_TIMEOUT_MAX);
    }

    mod reported_input {
        use std::sync::Arc;

        use super::*;
        use crate::agent::chat::session_store::SqliteSessionStore;
        use crate::common::git::WorkspaceSession;
        use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState};

        fn registry_with(title: (TitleSource, &str)) -> Registry {
            let registry = Registry::new(Arc::new(
                SqliteSessionStore::open_in_memory().expect("in-memory session store"),
            ));
            registry.register(
                SessionEntry::new(
                    "pty-1",
                    SessionKind::Terminal,
                    Some("pi".into()),
                    WorkspaceSession::of("p1", Some("/proj-wt".into())),
                    "/proj-wt",
                )
                .with_state(SessionState::Running),
            );
            // 夹具走**生产同一条**写路径（`set_title` → 准入 + 覆盖序），
            // 不直接改字段：否则夹具能造出 `admit` 不会放行的状态。
            registry.set_title("pty-1", title.0, title.1);
            registry
        }

        /// 首条输入 ⇒ `Prompt` 标题 + 立刻可见（发送即出现，不等 agent 跑完）。
        #[test]
        fn first_input_titles_and_reveals_the_session() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            let changed = apply_title(&registry, "pty-1", "  修复登录竞态 ", TitleSource::Prompt);
            let entry = &registry.snapshot()[0];
            assert!(changed);
            assert_eq!(entry.title, "修复登录竞态", "空白被折叠/裁剪");
            assert_eq!(entry.title_source, TitleSource::Prompt);
            assert!(entry.has_user_input, "发送那一刻标题已有 ⇒ 侧栏立刻列出");
        }

        /// `Native` 比 `Prompt` 强：CLI 已经自报标题时，用户首行不会把它改名
        ///（但 has_user_input 照置 —— 用户确实在用）。
        #[test]
        fn cli_native_title_wins_over_the_first_input() {
            let registry = registry_with((TitleSource::Native, "claude"));
            assert!(
                apply_title(&registry, "pty-1", "npm test", TitleSource::Prompt),
                "已发过输入（可见性）变化"
            );
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.title, "claude");
            assert_eq!(entry.title_source, TitleSource::Native);
        }

        /// 重复上报幂等（同一条输入重发不 bump 版本）。
        #[test]
        fn repeated_report_is_idempotent() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(apply_title(&registry, "pty-1", "ls", TitleSource::Prompt));
            let version = registry.version();
            assert!(!apply_title(&registry, "pty-1", "ls", TitleSource::Prompt));
            assert_eq!(registry.version(), version);
        }

        /// 后续提交不能改名：同一会话第一次命名为 `ls` 后，`pwd` 只恢复活动态。
        #[test]
        fn later_input_does_not_rename_the_session() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(apply_title(&registry, "pty-1", "ls", TitleSource::Prompt));
            let version = registry.version();
            assert!(
                !apply_title(&registry, "pty-1", "pwd", TitleSource::Prompt),
                "已有真标题时后续输入只允许状态变化"
            );
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.title, "ls");
            assert_eq!(entry.title_source, TitleSource::Prompt);
            assert_eq!(registry.version(), version, "仅改名被拒时不 bump");
        }

        /// 斜杠命令不是会话主题：不命名，但仍算「用户提交」（解除权威状态门）；
        /// 之后第一条真正的消息才命名。
        ///
        /// 实测事故：用户敲 `/model`，在自动补全菜单里按回车 —— 捕获到的是半截命令 `/mo`，
        /// 侧栏与 tab 标题都变成了这个既不是完整输入、也无从辨认的字符串。
        #[test]
        fn slash_command_does_not_become_the_title() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(
                apply_title(&registry, "pty-1", "/model", TitleSource::Prompt),
                "用户确实提交了（活动态要变），只是不该命名"
            );
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.title, "", "命令不是标题");
            assert!(entry.has_user_input, "但发送事实照记");
            assert_eq!(entry.title_source, TitleSource::Placeholder, "来源不升级");

            // 第一条真正的消息才命名。
            assert!(apply_title(
                &registry,
                "pty-1",
                "帮我看下 routing group",
                TitleSource::Prompt
            ));
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.title, "帮我看下 routing group");
            assert_eq!(entry.title_source, TitleSource::Prompt);
        }

        /// 未知会话：不建条目、不报错（迟到上报是常态）。
        #[test]
        fn unknown_report_is_dropped() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(!apply_title(
                &registry,
                "ghost",
                "hello",
                TitleSource::Prompt
            ));
            assert_eq!(registry.snapshot().len(), 1, "不得凭空建条目");
        }

        /// 空白 `Prompt` 仍是用户提交（审批只按 Enter 也能解除门），但不会写成标题；
        /// 空白 `Native` 则完全无动作。
        #[test]
        fn blank_input_engages_without_naming() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(
                apply_title(&registry, "pty-1", "   ", TitleSource::Prompt),
                "空白 Prompt 也是一次用户提交"
            );
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.title, "", "空白不能成为标题");
            assert!(entry.has_user_input);
            let version_after_prompt = registry.version();
            assert!(
                !apply_title(&registry, "pty-1", "   ", TitleSource::Native),
                "空白 Native 不动作"
            );
            assert_eq!(registry.version(), version_after_prompt);
        }

        /// 审批界面按 Enter 时没有标题素材，但必须解除 hook 的权威门。
        #[test]
        fn blank_approval_response_clears_the_authority_gate() {
            let registry = registry_with((TitleSource::Native, "claude"));
            assert!(registry.report_authoritative(
                "pty-1",
                None,
                crate::live_sessions::state::Signal::ApprovalRequested
            ));
            assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);

            assert!(apply_title(&registry, "pty-1", "  ", TitleSource::Prompt));
            let entry = &registry.snapshot()[0];
            assert_eq!(entry.state, SessionState::Running);
            assert!(!entry.awaiting_user_activity);
            assert_eq!(entry.title, "claude", "空提交不能覆盖真标题");
        }
    }

    mod native_title {
        use std::sync::Arc;

        use super::*;
        use crate::agent::chat::session_store::SqliteSessionStore;
        use crate::common::git::WorkspaceSession;
        use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};

        fn registry_with(cwd: &str, title: (TitleSource, &str)) -> Registry {
            let registry = Registry::new(Arc::new(
                SqliteSessionStore::open_in_memory().expect("in-memory session store"),
            ));
            registry.register(
                SessionEntry::new(
                    "pty-1",
                    SessionKind::Terminal,
                    Some("claude-code".into()),
                    WorkspaceSession::of("p1", Some(cwd.into())),
                    cwd,
                )
                .with_state(SessionState::Running),
            );
            // 同上：夹具经唯一写路径，`Placeholder` 的非空文本会被判负（这是正确行为）。
            registry.set_title("pty-1", title.0, title.1);
            registry
        }

        fn title_of(registry: &Registry) -> (String, TitleSource) {
            let entry = &registry.snapshot()[0];
            (entry.title.clone(), entry.title_source)
        }

        /// CLI 原生标题落 `Native`：`Placeholder` 被升级，来源也一并改写。
        #[test]
        fn native_title_upgrades_a_placeholder() {
            let registry = registry_with("/proj-wt", (TitleSource::Placeholder, "claude-code"));
            assert!(apply_title(
                &registry,
                "pty-1",
                "  Fix   the parser  ",
                TitleSource::Native
            ));
            assert_eq!(
                title_of(&registry),
                ("Fix the parser".to_string(), TitleSource::Native)
            );
        }

        /// 关键判据：包装层送的是 `Native` 而不是 `Prompt` —— 同级可覆盖（后者会返回
        /// `false`）。只断言最终标题值的用例在两种来源下都是绿的，区分不了这条。
        #[test]
        fn native_title_can_replace_another_native_title() {
            let registry = registry_with("/proj-wt", (TitleSource::Native, "old title"));
            assert!(
                apply_title(&registry, "pty-1", "new title", TitleSource::Native),
                "Native 同级允许覆盖（送 Prompt 会被拒）"
            );
            assert_eq!(title_of(&registry).0, "new title");
        }

        /// 用户改名永不被自动来源覆盖（CLI hook 的后续主题不能改写用户设置）。
        #[test]
        fn native_title_never_overrides_a_user_title() {
            let registry = registry_with("/proj-wt", (TitleSource::User, "my tab"));
            assert!(
                !apply_title(&registry, "pty-1", "a cli topic", TitleSource::Native),
                "Native 主题本身通过准入，被拒的唯一理由是覆盖序"
            );
            assert_eq!(
                title_of(&registry),
                ("my tab".to_string(), TitleSource::User)
            );
        }

        /// 未知会话 / 空白标题都不制造条目、不报错（迟到上报是常态）。
        #[test]
        fn native_title_ignores_unknown_sessions_and_blank_values() {
            let registry = registry_with("/proj-wt", (TitleSource::Placeholder, "Terminal"));
            assert!(!apply_title(
                &registry,
                "pty-404",
                "whatever",
                TitleSource::Native
            ));
            assert!(!apply_title(&registry, "pty-1", "   ", TitleSource::Native));
            assert_eq!(registry.snapshot().len(), 1, "不得凭空建条目");
            assert_eq!(
                title_of(&registry),
                (String::new(), TitleSource::Placeholder),
                "占位标题恒为空（`Placeholder` 永远不进标题）"
            );
        }

        /// `Placeholder` 经 IPC 传进来也不能写标题：占位不是标题。
        ///
        /// `source` 是前端可控的（`set_live_session_title` 的 `Option<TitleSource>`），
        /// 没有准入时它能造出一条「有名字的占位会话」，而那正是本任务从占位里删掉的噪声。
        #[test]
        fn placeholder_source_never_writes_a_title() {
            let registry = registry_with("/proj-wt", (TitleSource::Placeholder, ""));
            assert!(!apply_title(
                &registry,
                "pty-1",
                "claude-code",
                TitleSource::Placeholder
            ));
            assert_eq!(
                title_of(&registry),
                (String::new(), TitleSource::Placeholder)
            );
        }

        /// 同值不发：CLI hook 可能重复上报同一标题，
        /// 但注册表在标题未变时不 bump 版本（R2.3 的同一条判据）。
        #[test]
        fn repeated_identical_native_title_does_not_bump() {
            let registry = registry_with("/proj-wt", (TitleSource::Placeholder, "Terminal"));
            assert!(apply_title(
                &registry,
                "pty-1",
                "fix the parser",
                TitleSource::Native
            ));
            let version = registry.version();
            assert!(!apply_title(
                &registry,
                "pty-1",
                "fix the parser",
                TitleSource::Native
            ));
            assert_eq!(registry.version(), version, "同值不得 bump 版本");
        }
    }
}
