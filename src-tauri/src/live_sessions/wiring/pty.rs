//! terminal 生产者：PTY / WSL / SSH 会话的注册、活动与退出。
//!
//! 状态只经注册表改变，本模块提供三件事：
//!
//! 1. **登记**（[`LiveTerminal::register`]）：进程创建后立即登记，早于退出信号生产者；
//! 2. **活动**（[`OutputActivity`]）：输出流动 = 在跑，静默 = 回到就绪（唯一的「推断」，见下）；
//!    该推断经 [`Registry::apply_activity`]，不得越过 CLI hook 的权威状态门；
//! 3. **退出 / 关闭**（[`exit_and_notify`]；关闭与注销的唯一入口在
//!    [`crate::live_sessions::lifecycle`]）。
//!
//! 本模块只负责**把原生事实变成信号**；「转移 + 通知」的收尾在注册表域，不在生产者里。
//!
//! 会话的**标题与 has_user_input** 不在这里产生：用户输入只有前端分得清「人敲的」与「我们自动
//! 启动 agent 的那一行」，故由前端经 `report_live_session_activity` 上报活动 + 行文本；
//! **行文本能否当标题由 [`Registry::report_terminal_input`] 按 `agent_id` 裁决** —— 纯 shell
//! 可以，agent 终端不行（TUI 面板过滤词就在那条通道里）。标题其余来源：CLI hook /
//! conversation 缓存 / 用户改名（[`super::hooks`]）。
//!
//! # 顺序不变量（登记早于信号）
//!
//! 登记必须发生在**信号生产者启动之前**：先 exit 后 register 会让 [`Registry::apply`] 丢弃
//! 一条未知会话的退出信号（它绝不为未知会话建条目，见
//! `on_exit_for_unknown_session_is_a_no_op`），随后登记出来的条目永远停在 `Running`
//! —— 没有任何后续信号能清理它，用户看到一条点不动的幽灵行。
//!
//! # 活动判据：先看 CLI 说什么，再猜
//!
//! **第一级事实 —— CLI 自报**（`agent::cli_status`）：Codex 会在输出流里发
//! `ESC ] 7501 ; state=working|idle:app=codex ST`。这是逐次状态转换的明确宣告，
//! 一旦出现，本模块**立刻停止**用字节静默推断该会话（[`OutputActivity::observe`] 记下
//! 「已自报」，[`OutputActivity::poll`] 之后只应用它）。
//!
//! 为什么必须停掉推断：Codex 完成后仍会周期性重绘（光标 / 状态行），静默永远达不到
//! [`IDLE_AFTER`]，于是「任务已结束」一直显示绿色运行中（2026-11-02 真机反馈）。用
//! 更弱的事实覆盖更强的事实，正是这条 bug 的形态。
//!
//! **第二级（退路）—— 字节静默推断**：没有自报通道的 CLI 只有一种可观测事实
//! （**有没有字节出来**）。进程存活不区分「在算」与「在等你」，spinner 帧只改标题：
//!
//! - 有输出 ⇒ `TurnStarted`（`Running`）；
//! - 静默超过 [`IDLE_AFTER`] ⇒ `TurnFinished`（`Ready`）。
//!
//! 自报通道是**机会性升级**：CLI 版本不再发那个 OSC 时不会锁死状态（推断仍在跑）。
//!
//! **代价（必须诚实标注）**：模型长时间无输出的思考会被读成「就绪」，`sleep 30` 这类
//! 无输出命令同理。阈值取得比「命令之间的间隔」大、比「人愿意等的反馈延迟」小（1.5s），
//! 这是本仓在「完全没有信号」与「宁可粗略也要有反馈」之间的取舍，不是精确状态机。
//!
//! # 通知只此一份
//!
//! 「改状态 + 只有真变了才 `emit_changed`」的判据收在本模块的入口里
//! （[`LiveTerminal::register`] / [`OutputActivity::poll`] / [`exit_and_notify`]），
//! 关闭与注销则统一走 [`crate::live_sessions::lifecycle`]：分散到各调用点的话，第 N 个
//! 生产者忘写通知的表现是「侧栏不刷新、无报错、无日志」。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::agent::cli_status::{CliStatus, StatusChannel};
use crate::common::git::WorkspaceSession;
use crate::live_sessions::emit_changed;
use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState};
use crate::live_sessions::registry::Registry;
use crate::live_sessions::state::Signal;
use crate::live_sessions::wiring::status_mailbox::StatusMailbox;

/// 输出静默多久算「这一轮结束」。见模块注释的取舍说明。
pub(crate) const IDLE_AFTER: Duration = Duration::from_millis(1_500);

/// 注册 PTY 会话所需的**原生事实**（地址 + 运行根 + agent）。
///
/// 由命令层在解析 Workspace 时一次成型，随后沿 `router → manager → pipeline` 单向传递，
/// 中途不重组、不从命令行字符串反推 agent（`ChatLaunch::inprocess` 的教训）。
#[derive(Debug, Clone)]
pub(crate) struct TerminalRegistration {
    /// 执行地址。
    pub workspace: WorkspaceSession,
    /// 已解析的运行根（进程 cwd）。
    pub cwd: String,
    /// 该终端跑的是哪个 agent（纯 shell 为 `None`）—— **只用于图标**，不进标题。
    pub agent_id: Option<String>,
}

/// 「注册表 + 本次登记的原生事实」的绑定：登记的**唯一**入口。
///
/// 两个 `Option` 一起给：注册表未注入（测试 / 无 GUI）或调用方没带原生事实时整体为
/// `None` —— 终端照常工作，只是侧栏看不到会话。
#[derive(Clone, Copy)]
pub(crate) struct LiveTerminal<'a> {
    registry: &'a Arc<Registry>,
    registration: &'a TerminalRegistration,
}

impl<'a> LiveTerminal<'a> {
    /// 组合两个可选依赖；任一缺失即视为「未接线」。
    pub(crate) fn new(
        registry: Option<&'a Arc<Registry>>,
        registration: Option<&'a TerminalRegistration>,
    ) -> Option<Self> {
        Some(Self {
            registry: registry?,
            registration: registration?,
        })
    }

    /// 登记本会话并通知前端。
    ///
    /// 无条件通知（而不是只在「新增」时）：重复 id 的覆盖同样改变了快照内容，
    /// 而这条路径本就只在 `register` 已经打过 `log::warn!` 的缺陷场景下出现。
    pub(crate) fn register(&self, app: &AppHandle, session_id: &str) {
        register_terminal(self.registry, session_id, self.registration);
        emit_changed(app, self.registry.version());
    }

    /// 本会话的 CLI 是否在输出流里自报状态（`agent::cli_status` 的数据表）。
    ///
    /// 只凭 `agent_id` 查表 —— 调用点（reader / io 线程）不需要认识任何具体 CLI。
    pub(crate) fn status_channel(&self) -> Option<&'static StatusChannel> {
        crate::agent::cli_status::channel_for(self.registration.agent_id.as_deref())
    }

    /// 供 watcher / io 线程持有的注册表句柄（跨线程需要 `'static`）。
    pub(crate) fn shared_registry(&self) -> Arc<Registry> {
        Arc::clone(self.registry)
    }
}

/// 登记终端会话（进程创建成功后**立即**登记，早于退出信号生产者）。
///
/// **占位标题是空串**（`SessionEntry::new` 的固有形态，不给参数）：终端在 CLI 自己发
/// OSC 0/2 之前没有名字，而任何我们替它编的名字（agent 名 / 项目名 / `Terminal`）都是噪声 ——
/// 行已经在单元下面，项目名冗余；agent 由品牌图标表达。空标题由视图解释：侧栏只画图标，
/// tab 兜底到自己的 `title`（`resolveTabTitle`）。
///
/// 返回 `Registry::register` 的「是否新增」—— 只有测试用它区分「首登 / 覆盖」。
fn register_terminal(registry: &Registry, session_id: &str, input: &TerminalRegistration) -> bool {
    let agent_id = input.agent_id.as_deref().filter(|id| !id.trim().is_empty());
    registry.register(
        SessionEntry::new(
            session_id,
            SessionKind::Terminal,
            agent_id.map(str::to_string),
            input.workspace.clone(),
            input.cwd.as_str(),
        )
        // 进程已存活 ⇒ Running；静默 1.5s 后由 `OutputActivity` 落到 Ready。
        .with_state(SessionState::Running),
    )
}

/// 终端输出活动探针：跨线程共享的「最后一次输出」时间戳 + 可选的 CLI 自报信箱。
///
/// 由 reader / SSH io 线程 `observe()`，由 watcher / io 循环 `poll()` —— 两条共享边都是
/// 原子量（`AtomicU64` 存「相对 start 的毫秒数」，单调时钟不受系统时间调整影响；
/// 自报信箱见 [`StatusMailbox`] 的读侧无锁设计）。
#[derive(Clone)]
pub(crate) struct OutputActivity {
    start: Instant,
    last_ms: Arc<AtomicU64>,
    /// 该 agent 的自报通道；`None` = 没有自报，只有字节静默推断。
    cli: Option<Arc<StatusMailbox>>,
}

impl OutputActivity {
    /// 新建探针（时间原点 = 现在）。
    ///
    /// `channel = None`（该 agent 没有状态播报通道）⇒ 行为与旧版完全一致：只有静默推断。
    pub(crate) fn new(channel: Option<&'static StatusChannel>) -> Self {
        Self {
            start: Instant::now(),
            last_ms: Arc::new(AtomicU64::new(0)),
            cli: channel.map(|channel| Arc::new(StatusMailbox::new(channel))),
        }
    }

    /// 时间原点在过去的探针（仅测试：等价于「已经静默很久」，不 sleep 墙钟）。
    #[cfg(test)]
    fn started_at(start: Instant) -> Self {
        Self::started_at_with(start, None)
    }

    /// 同上，但带一个自报通道（测试用）。
    #[cfg(test)]
    fn started_at_with(start: Instant, channel: Option<&'static StatusChannel>) -> Self {
        let mut activity = Self::new(channel);
        activity.start = start;
        activity
    }

    /// 记录一次输出（每个字节块调用一次）：打点 + 喂给自报扫描器。
    pub(crate) fn observe(&self, bytes: &[u8]) {
        self.last_ms.store(self.elapsed_ms(), Ordering::Relaxed);
        if let Some(cli) = &self.cli {
            cli.feed(bytes);
        }
    }

    /// 按当前活动状态推进注册表；返回「状态是否真的变了」。
    ///
    /// 幂等：状态没变时 `apply` 返回 `false`，不 bump 版本、不发事件 —— 于是调用方
    /// （100ms / 250ms 的 tick）不会变成 IPC 风暴。`app` 为 `None` 时只改内存（测试）。
    pub(crate) fn poll(
        &self,
        registry: &Registry,
        app: Option<&AppHandle>,
        session_id: &str,
    ) -> bool {
        let mut changed = self.apply_cli_status(registry, session_id);
        // CLI 已经在自报 ⇒ 不再用字节静默猜。否则 Codex 完成后的周期性重绘会把
        // `Ready` 一直推回 `Running`（绿点不灭）。
        let infer_from_bytes = self.cli.as_ref().is_none_or(|cli| !cli.has_reported());
        if infer_from_bytes {
            let quiet = self
                .elapsed_ms()
                .saturating_sub(self.last_ms.load(Ordering::Relaxed));
            let signal = if quiet >= u64::try_from(IDLE_AFTER.as_millis()).unwrap_or(u64::MAX) {
                Signal::TurnFinished
            } else {
                Signal::TurnStarted
            };
            changed |= registry.apply_activity(session_id, signal);
        }
        crate::live_sessions::notify_if_changed(app, registry.version(), changed)
    }

    /// 应用 CLI 自报的最后一档状态（没有待应用项 ⇒ `false`）。
    ///
    /// 走 `Registry::apply`（直接信号）而不是 `apply_activity`：自报是 **CLI 自己**说的
    /// 事实，不是我们对字节流的推断，因此不受「权威 hook 门」约束（门存在的目的是挡住推断）。
    fn apply_cli_status(&self, registry: &Registry, session_id: &str) -> bool {
        let Some(status) = self.cli.as_ref().and_then(|cli| cli.take_pending()) else {
            return false;
        };
        let signal = match status {
            CliStatus::Working => Signal::TurnStarted,
            CliStatus::Idle => Signal::TurnFinished,
        };
        registry.apply(session_id, signal)
    }

    fn elapsed_ms(&self) -> u64 {
        u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// 退出码 → 终止信号（`None` = 拿不到退出码，按正常结束处理）。
#[must_use]
pub(crate) const fn exit_signal(exit_code: Option<i32>) -> Signal {
    match exit_code {
        Some(0) | None => Signal::Exited,
        Some(_) => Signal::Failed,
    }
}

/// child 退出：先落终止态，再注销条目（纯注册表操作，不发事件）。
///
/// 注销是必须的（tab 已随进程消失），终止态仍要在注销前落一次：写入面只有
/// `apply(signal)`，跳过它会让「退出原因」在未来接入持久化 / 统计时丢失。
fn on_exit(registry: &Registry, session_id: &str, exit_code: Option<i32>) -> bool {
    // 已被**主动关闭**（[`crate::live_sessions::lifecycle::close_and_notify`] 先标了 `Stopped`）⇒
    // 这次退出是那次关闭的尾巴。
    // 条目要留着：侧栏那一行是「点回来」的入口，关 tab 不该让它消失。
    if registry
        .entry(session_id)
        .is_some_and(|entry| entry.state == SessionState::Stopped)
    {
        return false;
    }
    let signal = exit_signal(exit_code);
    let changed = registry.apply(session_id, signal);
    let removed = registry.unregister(session_id);
    changed || removed
}

/// 进程退出：落终止态 + 注销 + 通知（唯一退出入口）。
pub(crate) fn exit_and_notify(
    registry: &Registry,
    app: &AppHandle,
    session_id: &str,
    exit_code: Option<i32>,
) -> bool {
    let changed = on_exit(registry, session_id, exit_code);
    crate::live_sessions::notify_if_changed(Some(app), registry.version(), changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::session_store::{SessionStore, SqliteSessionStore};
    use crate::live_sessions::lifecycle::close_and_notify;
    use crate::live_sessions::state::reduce;

    fn fresh_registry() -> Registry {
        Registry::new(Arc::new(
            SqliteSessionStore::open_in_memory().expect("in-memory session store"),
        ))
    }

    fn registration(agent_id: Option<&str>) -> TerminalRegistration {
        TerminalRegistration {
            workspace: WorkspaceSession::of("p1", Some("/proj-wt".into())),
            cwd: "/proj-wt/src".into(),
            agent_id: agent_id.map(str::to_string),
        }
    }

    /// 注册必须带上 workspace / agent_id / cwd（侧栏分组与图标都靠它）。
    #[test]
    fn register_terminal_carries_the_address_and_agent() {
        let registry = fresh_registry();
        assert!(register_terminal(
            &registry,
            "t1",
            &registration(Some("claude-code"))
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.kind, SessionKind::Terminal);
        assert_eq!(entry.agent_id.as_deref(), Some("claude-code"));
        assert_eq!(entry.workspace, registration(None).workspace);
        assert_eq!(entry.cwd, "/proj-wt/src");
        assert_eq!(entry.state, SessionState::Running, "活着的进程就是 Running");
    }

    /// 占位标题是**空串**：终端在 CLI 自报 OSC 标题前没有名字。
    ///
    /// 任何替它编的名字都是噪声：agent 名（`pi`）不可读，项目名与单元行重复。
    /// 空标题由视图解释成「只画图标」（侧栏）/「兜底 tab.title」（tab）。
    #[test]
    fn placeholder_title_is_empty_until_the_cli_names_itself() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("claude-code")));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "", "不替会话编名字");
        assert_eq!(
            entry.title_source,
            crate::live_sessions::entry::TitleSource::Placeholder
        );
        assert_eq!(
            entry.agent_id.as_deref(),
            Some("claude-code"),
            "agent 只留给图标"
        );
    }

    /// 纯 shell 与带 agent 的终端一样：没有真实标题就是空串（不回落 `Terminal`）。
    #[test]
    fn plain_shell_terminal_also_has_no_placeholder_name() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.agent_id, None);
        assert_eq!(entry.title, "");
    }

    #[test]
    fn blank_agent_id_counts_as_no_agent() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("   ")));
        assert_eq!(registry.snapshot()[0].agent_id, None);
    }

    /// 退出码两态：0 / 无 → `Stopped`，非 0 → `Failed`。
    #[test]
    fn exit_code_maps_to_the_terminal_state() {
        assert_eq!(exit_signal(Some(0)), Signal::Exited);
        assert_eq!(exit_signal(None), Signal::Exited);
        assert_eq!(exit_signal(Some(1)), Signal::Failed);
        assert_eq!(exit_signal(Some(127)), Signal::Failed);

        // 与 `reduce` 组合即得最终状态（无需起进程）。
        assert_eq!(
            reduce(SessionState::Running, exit_signal(Some(0))),
            Some(SessionState::Stopped)
        );
        assert_eq!(
            reduce(SessionState::Running, exit_signal(None)),
            Some(SessionState::Stopped)
        );
        assert_eq!(
            reduce(SessionState::Running, exit_signal(Some(1))),
            Some(SessionState::Failed)
        );
    }

    /// 退出后条目注销（视图里不再出现），且注销本身是一次可见变更。
    #[test]
    fn on_exit_unregisters_the_session() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        let before = registry.version();
        assert!(on_exit(&registry, "t1", Some(0)));
        assert!(registry.snapshot().is_empty());
        assert!(registry.version() > before);
        // 幂等：重复退出（watcher 与 close 双路径）不 panic、不再变化。
        assert!(!on_exit(&registry, "t1", Some(0)));
    }

    /// 主动关闭之后 PTY 的退出是**那次关闭的尾巴**：不得把条目注销掉。
    ///
    /// 回归钉子：`close_and_notify` 只标状态，随后的 `exit_and_notify` 若照常注销，
    /// 关 tab 仍会让侧栏少一行 —— 用户看到的就是「关了 tab 会话就没了」。
    #[test]
    fn exit_after_an_explicit_close_does_not_unregister() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        assert!(close_and_notify(&registry, None, "t1"));

        assert!(!on_exit(&registry, "t1", None), "尾巴不该产生变更");
        assert!(
            registry.entry("t1").is_some(),
            "关 tab 之后的退出不得摘条目"
        );
    }

    /// **持久化契约（故意相反）**：同一个物理事实「终端进程结束」有两条入口，行去留不同：
    ///
    /// - 用户点 X（[`close_and_notify`]）⇒ 行**保留**（`Stopped`，是「点回来」的入口）；
    /// - 进程自己结束（[`on_exit`]）⇒ 行**删除**（会话真的结束了）。
    ///
    /// 钉在库上而不是只钉内存：状态列没有读者（`into_entry` 恒投影 `Stopped`），真正决定
    /// 「重启后还看不看得见这一行」的是行是否存在。产品若要把两条入口统一，改这里会红 ——
    /// 那正是本用例存在的意义（保留策略见 `prd.md` §12.6.1）。
    #[test]
    fn natural_exit_deletes_the_row_while_an_explicit_close_keeps_it() {
        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        let registry = Registry::new(store.clone());
        let base = registration(Some("claude-code"));

        for id in ["natural", "closed"] {
            let mut entry = SessionEntry::new(
                id,
                SessionKind::Terminal,
                base.agent_id.clone(),
                base.workspace.clone(),
                base.cwd.as_str(),
            )
            .with_state(SessionState::Running)
            // 列出的会话才落盘（写门 = `has_user_input`）。
            .with_user_input(true);
            entry.title = format!("会话-{id}");
            entry.title_source = crate::live_sessions::entry::TitleSource::Prompt;
            registry.register(entry);
        }
        assert!(store.load_cursor("natural").is_some(), "夹具：两行都在库里");
        assert!(store.load_cursor("closed").is_some());

        // 路径 A：进程自己结束 ⇒ 行随会话一起消失。
        assert!(on_exit(&registry, "natural", Some(0)));
        assert!(store.load_cursor("natural").is_none(), "自然结束必须删行");

        // 路径 B：关 tab ⇒ 随后的退出是那次关闭的尾巴，行留着跨重启。
        assert!(close_and_notify(&registry, None, "closed"));
        assert!(!on_exit(&registry, "closed", None));
        let kept = store
            .load_cursor("closed")
            .expect("关 tab 的行必须留在库里");
        assert_eq!(kept.title, "会话-closed");
    }

    /// 未知会话的退出信号被丢弃（不会凭空建条目）。
    ///
    /// 这条也是「登记必须早于信号」的判据：若登记晚于退出，这里丢弃的那条信号
    /// 就再也不会重放，登记出来的条目会永远停在 `Running`。
    #[test]
    fn on_exit_for_unknown_session_is_a_no_op() {
        let registry = fresh_registry();
        assert!(!on_exit(&registry, "ghost", Some(1)));
        assert!(registry.snapshot().is_empty());
    }

    /// 未接线（注册表或原生事实缺失）⇒ 整体 `None`，终端照常工作。
    #[test]
    fn live_terminal_requires_both_halves() {
        let registry = Arc::new(fresh_registry());
        let registration = registration(None);
        assert!(LiveTerminal::new(None, Some(&registration)).is_none());
        assert!(LiveTerminal::new(Some(&registry), None).is_none());
        let live = LiveTerminal::new(Some(&registry), Some(&registration)).expect("wired");
        // 共享句柄指向同一个注册表（watcher 线程用它发退出信号）。
        assert_eq!(live.shared_registry().version(), registry.version());
    }

    /// 活动判据：刚有输出 ⇒ Running；静默超过阈值 ⇒ Ready（状态机本身不变）。
    ///
    /// 直接驱动 `Signal`（不 sleep）：`poll` 的时间来源是单调时钟，测试里用
    /// `reduce` 验证两端的转移，避免 1.5s 的墙钟等待。
    #[test]
    fn activity_maps_output_to_running_and_quiet_to_ready() {
        assert_eq!(
            reduce(SessionState::Ready, Signal::TurnStarted),
            Some(SessionState::Running)
        );
        assert_eq!(
            reduce(SessionState::Running, Signal::TurnFinished),
            Some(SessionState::Ready)
        );
        // 阈值是「人愿意等的反馈延迟」量级，不是 0 —— 否则每个字节块都会翻一次状态。
        assert!(IDLE_AFTER >= Duration::from_millis(1_000));
    }

    /// 探针幂等：同一活动状态反复 `poll` 只有第一次 bump（100ms tick 不得变成 IPC 风暴）。
    #[test]
    fn polling_a_stable_state_bumps_once() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        let activity = OutputActivity::new(None);
        // 刚注册 = Running；静默未达阈值 ⇒ TurnStarted ⇒ 状态未变。
        let before = registry.version();
        assert!(!activity.poll(&registry, None, "t1"));
        assert_eq!(registry.version(), before);
    }

    /// 静默 → Ready → 新输出 → Running 的完整往返（一个探针、一个时间原点）。
    #[test]
    fn activity_flows_between_running_and_ready() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        // 原点前移 2×阈值 = 「从没出过字节」的等价形态（不 sleep 墙钟）。
        let activity = OutputActivity::started_at(Instant::now() - IDLE_AFTER * 2);

        assert!(activity.poll(&registry, None, "t1"), "静默 ⇒ 落到 Ready");
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
        assert!(!activity.poll(&registry, None, "t1"), "重复 poll 不 bump");

        activity.observe(b"x");
        assert!(
            activity.poll(&registry, None, "t1"),
            "有新输出 ⇒ 回到 Running"
        );
        assert_eq!(registry.snapshot()[0].state, SessionState::Running);
    }

    /// 生产探针不得越过 hook 的权威门：完成后重新进入 CLI 产生的输出只更新
    /// `last_ms`，`poll` 仍应保持 Ready；用户提交后同一探针才恢复 Running。
    #[test]
    fn output_poll_respects_authoritative_completion_until_user_input() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(None));
        assert!(registry.report_authoritative("t1", None, Signal::TurnFinished));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        let activity = OutputActivity::new(None);
        activity.observe(b"x");
        assert!(
            !activity.poll(&registry, None, "t1"),
            "CLI 完成后的 TUI 重绘不得把 Ready 推回 Running"
        );
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        assert!(registry.report_terminal_input("t1", ""));
        assert_eq!(registry.snapshot()[0].state, SessionState::Running);
        assert!(!activity.poll(&registry, None, "t1"), "Running 已稳定");
    }

    /// Codex 之所以要自报通道：**任务完成后它仍会周期性重绘**，静默永远攒不到阈值。
    /// 这里用「有输出」模拟重绘：没有自报通道时这确实会被读成 Running（旧 bug 的形态）。
    #[test]
    fn repaint_without_a_status_channel_reads_as_running() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("codex")));
        let activity = OutputActivity::started_at(Instant::now() - IDLE_AFTER * 2);
        assert!(activity.poll(&registry, None, "t1"), "先静默落到 Ready");
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        // 无自报通道 ⇒ 重绘（有新字节）把状态推回 Running。
        activity.observe(b"\x1b[?25l");
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Running);
    }

    /// 有自报通道时：CLI 说 idle ⇒ Ready，且之后的字节重绘**不再**改动状态。
    #[test]
    fn cli_reported_state_wins_over_byte_silence_inference() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("codex")));
        let channel = crate::agent::cli_status::channel_for(Some("codex"));
        let activity = OutputActivity::started_at_with(Instant::now() - IDLE_AFTER * 2, channel); // 先靠静默推断落到 Ready（还没出现自报之前的默认行为）。
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        // 一轮开始 → working。
        activity.observe(b"\x1b]7501;state=working:app=codex\x1b\\");
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Running);

        // 一轮结束（hook 没装 / 归因失败也不要紧，CLI 自己说了算）。
        activity.observe(b"\x1b]7501;state=idle:app=codex\x1b\\");
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        // 进入 tab 触发的 TUI 重绘：有字节，但状态不许再变（绿点必须灭着）。
        activity.observe(b"\x1b[2K\x1b[1;1H repaint");
        assert!(
            !activity.poll(&registry, None, "t1"),
            "CLI 已经在自报状态，字节静默推断必须停用"
        );
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
    }

    /// 没有新字节也必须把「已收到的自报」应用一次（reader 写、watcher 取，两者解耦）。
    #[test]
    fn cli_status_is_applied_on_the_next_poll() {
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("codex")));
        let channel = crate::agent::cli_status::channel_for(Some("codex"));
        let activity = OutputActivity::new(channel);

        activity.observe(b"\x1b]7501;state=idle:app=codex\x1b\\");
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
        // 幂等：同一档状态不重复 bump。
        assert!(!activity.poll(&registry, None, "t1"));
    }

    /// 数据表之外的 agent 拿不到通道：旧行为原样保留（字节 = 活动，静默 = 就绪）。
    ///
    /// 这条用例同时钉住「机会性升级」的边界：解析器只认声明过的 agent，不会把别的
    /// CLI 输出里偶然出现的同样字节当成状态。
    #[test]
    fn agents_without_a_channel_keep_pure_byte_inference() {
        assert!(crate::agent::cli_status::channel_for(Some("claude-code")).is_none());
        let registry = fresh_registry();
        register_terminal(&registry, "t1", &registration(Some("claude-code")));
        let activity = OutputActivity::started_at(Instant::now() - IDLE_AFTER * 2);
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

        // 同样的字节，在没有通道的会话里只是一次「有输出」。
        activity.observe(b"\x1b]7501;state=idle:app=codex\x1b\\");
        assert!(activity.poll(&registry, None, "t1"));
        assert_eq!(
            registry.snapshot()[0].state,
            SessionState::Running,
            "没有通道 ⇒ 走静默推断（有字节 = 在跑），不解析状态"
        );
    }
}
