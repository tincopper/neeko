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

/// 回传会话标题：CLI 的 OSC 0/2（`source = native`）或用户的**首条输入行**
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
/// - `source = prompt`（用户首条输入）⇒ 同时标记「用户已在用」（侧栏据此立刻列出该会话），
///   标题按 `Prompt` 参与单调升级（`Native` / `User` 更强，不会被覆盖）；
/// - `source = native`（CLI 自报）⇒ 只升级标题。
///
/// 空白文本什么都没发生。`Result` 是 IPC 契约而不是当下的错误分支（前端 `invoke<boolean>`
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
        // 与另外两个生产者（chat 合帧 emit / PTY 注册与退出）同口径：版本真的变了就
        // 通知一次（载荷只有版本号）。
        emit_changed(&app_handle, state.live_sessions.version());
    }
    Ok(changed)
}

/// 标题上报的**唯一**决策（`source` 决定是否顺带把会话标成「在用」）。
///
/// 抽成自由函数以便直测（不需要 Tauri 运行时）—— `Native` 与 `Prompt` 的差别只能靠
/// 「同级可覆盖 / 弱级被拒」的用例区分，断言最终标题值本身区分不了。
///
/// 两次写入（标题升级 + 可见性）合并成注册表的**一次**加锁（`Registry::report`）：
/// 升级规则与「已在用」的判据各自只有一份实现。
fn apply_title(registry: &Registry, session_id: &str, title: &str, source: TitleSource) -> bool {
    if title.trim().is_empty() {
        return false;
    }
    registry.report(
        session_id,
        Some((source, title)),
        // 用户发过输入 = 这条会话已经在用（即便标题被更强的来源挡住，可见性也该翻转）。
        source == TitleSource::Prompt,
    )
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
                    (title.0, title.1.to_string()),
                )
                .with_state(SessionState::Running),
            );
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

        /// 未知会话 / 空白文本：不建条目、不报错（迟到上报是常态）。
        #[test]
        fn unknown_or_blank_reports_are_dropped() {
            let registry = registry_with((TitleSource::Placeholder, ""));
            assert!(!apply_title(
                &registry,
                "ghost",
                "hello",
                TitleSource::Prompt
            ));
            assert_eq!(registry.snapshot().len(), 1, "不得凭空建条目");
            let version = registry.version();
            assert!(
                !apply_title(&registry, "pty-1", "   ", TitleSource::Prompt),
                "空白不置 has_user_input"
            );
            assert_eq!(registry.version(), version);
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
                    (title.0, title.1.to_string()),
                )
                .with_state(SessionState::Running),
            );
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
            assert!(!apply_title(
                &registry,
                "pty-1",
                "claude",
                TitleSource::Native
            ));
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
            assert_eq!(title_of(&registry).0, "Terminal");
        }

        /// 同值不发：CLI hook 可能重复上报同一标题，
        /// 但注册表在标题未变时不 bump 版本（R2.3 的同一条判据）。
        #[test]
        fn repeated_identical_native_title_does_not_bump() {
            let registry = registry_with("/proj-wt", (TitleSource::Placeholder, "Terminal"));
            assert!(apply_title(
                &registry,
                "pty-1",
                "claude",
                TitleSource::Native
            ));
            let version = registry.version();
            assert!(!apply_title(
                &registry,
                "pty-1",
                "claude",
                TitleSource::Native
            ));
            assert_eq!(registry.version(), version, "同值不得 bump 版本");
        }
    }
}
