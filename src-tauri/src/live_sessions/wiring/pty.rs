//! terminal 生产者：PTY / WSL / SSH 会话的注册、活动与退出。
//!
//! 状态只经 [`Registry::apply`] 改变，本模块提供三件事：
//!
//! 1. **登记**（[`LiveTerminal::register`]）：进程创建后立即登记，早于退出信号生产者；
//! 2. **活动**（[`OutputActivity`]）：输出流动 = 在跑，静默 = 回到就绪（唯一的「推断」，见下）；
//! 3. **退出 / 关闭**（[`exit_and_notify`] / [`unregister_and_notify`]）。
//!
//! 会话的**标题与 has_user_input** 不在这里产生：用户输入只有前端分得清「人敲的」与「我们自动
//! 启动 agent 的那一行」，故由前端经 `set_live_session_title`（`source = prompt`）上报
//! （见 commands 里的命令文档）；CLI 自己的命名经 hook 上报（[`super::hooks`]）。
//!
//! # 顺序不变量（登记早于信号）
//!
//! 登记必须发生在**信号生产者启动之前**：先 exit 后 register 会让 [`Registry::apply`] 丢弃
//! 一条未知会话的退出信号（它绝不为未知会话建条目，见
//! `on_exit_for_unknown_session_is_a_no_op`），随后登记出来的条目永远停在 `Running`
//! —— 没有任何后续信号能清理它，用户看到一条点不动的幽灵行。
//!
//! # 活动判据（唯一的「推断」，也是唯一会退化成假数据的地方）
//!
//! PTY 只有一种可观测事实：**有没有字节出来**。进程存活不区分「在算」与「在等你」，
//! CLI 的 spinner 帧只改标题、不表达完成。因此：
//!
//! - 有输出 ⇒ `TurnStarted`（`Running`）；
//! - 静默超过 [`IDLE_AFTER`] ⇒ `TurnFinished`（`Ready`）。
//!
//! **代价（必须诚实标注）**：模型长时间无输出的思考会被读成「就绪」，`sleep 30` 这类
//! 无输出命令同理。阈值取得比「命令之间的间隔」大、比「人愿意等的反馈延迟」小（1.5s），
//! 这是本仓在「完全没有信号」与「宁可粗略也要有反馈」之间的取舍，不是精确状态机。
//!
//! # 通知只此一份
//!
//! 「改状态 + 只有真变了才 `emit_changed`」的判据收在本模块的入口里
//! （[`LiveTerminal::register`] / [`OutputActivity::poll`] / [`exit_and_notify`] /
//! [`unregister_and_notify`]）：分散到各调用点的话，第 N 个生产者忘写通知的表现是
//! 「侧栏不刷新、无报错、无日志」。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::common::git::WorkspaceSession;
use crate::live_sessions::emit_changed;
use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};
use crate::live_sessions::registry::Registry;
use crate::live_sessions::state::Signal;

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

    /// 供 watcher / io 线程持有的注册表句柄（跨线程需要 `'static`）。
    pub(crate) fn shared_registry(&self) -> Arc<Registry> {
        Arc::clone(self.registry)
    }
}

/// 登记终端会话（进程创建成功后**立即**登记，早于退出信号生产者）。
///
/// **占位标题是空串**：终端在 CLI 自己发 OSC 0/2 之前没有名字，而任何我们替它编的名字
/// （agent 名 / 项目名 / `Terminal`）都是噪声 —— 行已经在单元下面，项目名冗余；agent 由
/// 品牌图标表达。空标题由视图解释：侧栏只画图标，tab 兜底到自己的 `title`
/// （`resolveTabTitle`）。
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
            (TitleSource::Placeholder, String::new()),
        )
        // 进程已存活 ⇒ Running；静默 1.5s 后由 `OutputActivity` 落到 Ready。
        .with_state(SessionState::Running),
    )
}

/// 终端输出活动探针：跨线程共享的「最后一次输出」时间戳。
///
/// 由 reader / SSH io 线程 `stamp()`，由 watcher / io 循环 `poll()` —— 读写双方都不持锁
/// （`AtomicU64` 存「相对 start 的毫秒数」，单调时钟不会受系统时间调整影响）。
#[derive(Clone)]
pub(crate) struct OutputActivity {
    start: Instant,
    last_ms: Arc<AtomicU64>,
}

impl OutputActivity {
    /// 新建探针（时间原点 = 现在）。
    pub(crate) fn new() -> Self {
        Self {
            start: Instant::now(),
            last_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 时间原点在过去的探针（仅测试：等价于「已经静默很久」，不 sleep 墙钟）。
    #[cfg(test)]
    fn started_at(start: Instant) -> Self {
        Self {
            start,
            last_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 记录一次输出（每个字节块调用一次）。
    pub(crate) fn stamp(&self) {
        self.last_ms.store(self.elapsed_ms(), Ordering::Relaxed);
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
        let quiet = self
            .elapsed_ms()
            .saturating_sub(self.last_ms.load(Ordering::Relaxed));
        let signal = if quiet >= u64::try_from(IDLE_AFTER.as_millis()).unwrap_or(u64::MAX) {
            Signal::TurnFinished
        } else {
            Signal::TurnStarted
        };
        let changed = registry.apply(session_id, signal);
        if let (true, Some(app)) = (changed, app) {
            emit_changed(app, registry.version());
        }
        changed
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
    if changed {
        emit_changed(app, registry.version());
    }
    changed
}

/// 主动关闭：注销 + 通知（唯一关闭入口）。
///
/// `app` 为 `None` 的调用方（退出清理 / 测试）只做注销不发事件 —— 那时没有前端在听。
pub(crate) fn unregister_and_notify(
    registry: &Registry,
    app: Option<&AppHandle>,
    session_id: &str,
) -> bool {
    let removed = registry.unregister(session_id);
    if let (true, Some(app)) = (removed, app) {
        emit_changed(app, registry.version());
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::session_store::SqliteSessionStore;
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
        assert_eq!(entry.title_source, TitleSource::Placeholder);
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
        let activity = OutputActivity::new();
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

        activity.stamp();
        assert!(
            activity.poll(&registry, None, "t1"),
            "有新输出 ⇒ 回到 Running"
        );
        assert_eq!(registry.snapshot()[0].state, SessionState::Running);
    }
}
