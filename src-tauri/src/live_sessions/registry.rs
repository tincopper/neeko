//! Live session 注册表：**内存唯一事实** + 写穿持久化。
//!
//! # 不变量
//!
//! 1. 状态只能经信号改变：直接信号走 [`Registry::apply`]，PTY 推断走
//!    [`Registry::apply_activity`]，CLI 权威事件走 [`Registry::report_authoritative`]
//!    （外加 `register` / `unregister` 两个生命周期动作）。视图层拿不到 `&mut SessionEntry`。
//! 2. 版本号只在**真的变了**时 bump（R2.3：审批往返不刷 IPC）。前端凭版本号决定是否再拉一次。
//! 3. 未知会话的迟到信号被丢弃并 `log::debug!`，**绝不为它凭空建条目**
//!    （凭空建条目 = 侧栏多出一条没人创建的会话）。
//! 4. 锁内只做 map 操作与克隆；落盘与日志一律在锁外
//!    （`concurrency-guidelines.md` 红线 3 口径）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use chrono::Utc;

use crate::agent::chat::session_store::{ResumeCursor, SessionStore};
use crate::live_sessions::entry::{SessionEntry, SessionState, TitleSource};
use crate::live_sessions::state::{reduce, Signal};
use crate::live_sessions::title;

/// 会话注册表。
pub struct Registry {
    /// `session_id → 条目`（唯一事实）。
    sessions: Mutex<HashMap<String, SessionEntry>>,
    /// 变更版本号（长轮询的比较基准）。单调递增，初值 0。
    version: AtomicU64,
    /// 应用是否正在退出。置位后 `unregister` 只摘内存，不删持久化行 ——
    /// 退出不能等价于「清空侧栏列表」。崩溃 / 强杀天然满足（根本没走到 `unregister`）。
    shutting_down: AtomicBool,
    /// 版本变更唤醒器（credit-pull：前端挂起等版本，不推全量快照）。
    ///
    /// 用 `notify_one`（无 waiter 时存一个 permit）而不是 `notify_waiters`：
    /// 「检查版本 → 注册 waiter」之间的竞态窗口由 permit 覆盖，代价至多多循环一次。
    changed: tokio::sync::Notify,
    /// 持久化后端：侧栏列表条目（`has_user_input` 的那些行）。
    store: Arc<dyn SessionStore>,
    /// 落盘闸门：把「从内存投影 → 写库」串行化。
    ///
    /// 同一会话有三个写者（Tauri 命令线程 / hook HTTP 线程 / chat 事件泵），而 `store` 是
    /// 阻塞 IO、不能在 `sessions` 锁内调用。没有闸门时，后拿到锁的写者可能拿一份**更旧**的
    /// 快照去覆盖（用户改名 / 原生 id 回退，只在重启后暴露）。闸门内**重新**投影一次，
    /// 写入顺序就与内存顺序一致（全量快照，最后一次写必然包含此前全部变更）。
    persist_gate: Mutex<()>,
}

impl Registry {
    /// 用既有 `SessionStore` 构造空注册表（与 `AgentChatManager` 共用同一实例）。
    #[must_use]
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            version: AtomicU64::new(0),
            shutting_down: AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
            store,
            persist_gate: Mutex::new(()),
        }
    }

    /// 当前版本号。
    #[must_use]
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::SeqCst)
    }

    /// 登记一条会话，返回「是否新增」（`false` = 覆盖了同 id 的既有条目）。
    ///
    /// 重复 id 只 `log::warn!` 并覆盖，绝不 panic：会话 id 撞车是上游缺陷，但把它
    /// 变成崩溃只会让整个注册表不可用。
    pub fn register(&self, entry: SessionEntry) -> bool {
        let session_id = entry.session_id.clone();
        let duplicate = {
            let mut sessions = self.guard();
            let duplicate = sessions.contains_key(&session_id);
            sessions.insert(session_id.clone(), entry);
            duplicate
        };
        if duplicate {
            log::warn!("[live_sessions] duplicate session id registered, overriding: {session_id}");
        }
        self.bump();
        self.persist_entry(&session_id);
        !duplicate
    }

    /// 只在会话**尚未登记**时登记，返回「是否新增」（`false` = 已存在，**什么都没写**）。
    ///
    /// 与 [`Registry::register`] 的差别有两个：不覆盖既有条目、不为重复 id 记 warn 也不 bump。
    /// 「登记 = 首次出现」这条判据只在锁内成立一次 —— 判据与写入必须同一个临界区，
    /// 否则 `contains` 之后、`register` 之前插进来的条目会被静默覆盖。
    pub fn register_if_absent(&self, entry: SessionEntry) -> bool {
        let session_id = entry.session_id.clone();
        {
            let mut sessions = self.guard();
            if sessions.contains_key(&session_id) {
                return false;
            }
            sessions.insert(session_id.clone(), entry);
        }
        self.bump();
        self.persist_entry(&session_id);
        true
    }

    /// 应用一条直接信号（chat 事件 / 终止等）。返回「状态是否真的变了」
    /// （调用方据此决定是否发变更事件）。
    ///
    /// 未知会话 → `false` + `log::debug!`（不建条目）；状态未变 / 信号被吸收 → `false`。
    pub fn apply(&self, session_id: &str, signal: Signal) -> bool {
        self.apply_signal(session_id, signal, false)
    }

    /// 应用一条**输出推断**信号（PTY 字节活动）。权威状态门关闭期间，`TurnStarted` /
    /// `TurnFinished` 都不得改写 hook 给出的完成 / 审批态。
    pub fn apply_activity(&self, session_id: &str, signal: Signal) -> bool {
        self.apply_signal(session_id, signal, true)
    }

    fn apply_signal(&self, session_id: &str, signal: Signal, from_activity: bool) -> bool {
        // 外层 `None` = 会话未知；内层 `(changed, persist)` = 状态是否变、是否该写穿。
        let outcome = self.mutate(session_id, |entry| {
            if from_activity
                && entry.awaiting_user_activity
                && matches!(signal, Signal::TurnStarted | Signal::TurnFinished)
            {
                return (false, false);
            }
            apply_transition(entry, signal)
        });
        match outcome {
            None => {
                log::debug!("[live_sessions] dropped {signal:?} for unknown session: {session_id}");
                false
            }
            Some((changed, persist)) => {
                if changed {
                    self.bump();
                    if persist {
                        self.persist_entry(session_id);
                    }
                }
                changed
            }
        }
    }

    /// 标题升级与（可选）可见性置位的**合并写**。
    ///
    /// 用户提交、权威 hook 与 chat 首次 Engage 已各自收敛到更明确的入口；本方法
    /// 继续承载 CLI 纯信息事件与显式标题上报。所有入口共用 [`title::should_upgrade`]
    /// 这一份升级规则。
    ///
    /// - `title = None`：只置位（`engage`）或什么都不做；
    /// - `engage = false`：只升级标题（CLI 的纯信息类事件）。
    ///
    /// **打开 tab 不调用** —— PTY / 静默会话的创建不是「用户在用它」。
    /// 未知会话 `false`（不建条目）。
    pub fn report(
        &self,
        session_id: &str,
        title: Option<(TitleSource, &str)>,
        engage: bool,
    ) -> bool {
        let applied = self.mutate(session_id, |entry| {
            let mut changed = false;
            if let Some((source, text)) = title {
                changed |= upgrade_title(entry, source, text);
            }
            if engage && !entry.has_user_input {
                entry.has_user_input = true;
                changed = true;
            }
            if changed {
                entry.updated_at = Utc::now();
            }
            changed
        });
        self.finish(session_id, applied, "report")
    }

    /// 用户提交输入的**唯一合并写**：首次标题 + 置位已使用 + 清除权威状态门 + 进入 Running。
    ///
    /// 首次输入既要成为标题素材，也要让会话立刻可见；后续输入只需要把已完成的会话
    /// 重新推回活跃态。两者共用本入口，避免调用方在多个锁之间拼状态。
    ///
    /// **只有尚无真标题时**才用 `Prompt` 命名。后续提交即使携带了不同的命令文本，
    /// 也不能把会话名改掉（用户用侧栏识别会话，改名必须只来自显式改名或更强的来源）。
    ///
    /// 空白行仍是**一次用户提交**（审批界面可能只按 Enter），只是不作为标题素材。
    pub fn report_user_input(&self, session_id: &str, title: &str) -> bool {
        let applied = self.mutate(session_id, |entry| {
            if entry.state.is_terminal() {
                return false;
            }
            let mut changed = false;
            if !has_real_title(entry) {
                changed |= upgrade_title(entry, TitleSource::Prompt, title);
            }
            changed |= mark_entry_user_activity(entry);
            if changed {
                entry.updated_at = Utc::now();
            }
            changed
        });
        self.finish(session_id, applied, "report_user_input")
    }

    /// 权威 hook 事件：一次加锁内升级标题 / 置位 / 状态转移，并关闭 PTY 输出推断。
    ///
    /// 只有 `turn_completed` / 审批请求 / 失败会走这里；纯信息事件仍走 [`Registry::report`]，
    /// 不得影响状态。权威事件本身就是「用户相关的会话事实」，因此同时置位
    /// `has_user_input`，不额外暴露一个恒为 `true` 的调用参数。
    pub fn report_authoritative(
        &self,
        session_id: &str,
        title: Option<(TitleSource, &str)>,
        signal: Signal,
    ) -> bool {
        let outcome = self.mutate(session_id, |entry| {
            let mut changed = false;
            if let Some((source, text)) = title {
                changed |= upgrade_title(entry, source, text);
            }
            if !entry.has_user_input {
                entry.has_user_input = true;
                changed = true;
            }
            let (state_changed, _) = apply_transition(entry, signal);
            changed |= state_changed;
            // 只有非终止的「等待用户」态需要门。终止态已被状态机永久吸收，
            // 再置门只会让字段语义失真。
            if !entry.state.is_terminal()
                && matches!(signal, Signal::TurnFinished | Signal::ApprovalRequested)
            {
                entry.awaiting_user_activity = true;
            }
            if changed {
                entry.updated_at = Utc::now();
            }
            // 权威事件（每回合一次）同时携带标题与可见性；写穿由 `persist_entry` 在闸门内
            // 重新投影（未列出的会话仍由 `from_entry` 返回 `None` 挡掉）。
            changed
        });
        match outcome {
            None => {
                log::debug!(
                    "[live_sessions] authoritative event for unknown session: {session_id}"
                );
                false
            }
            Some(changed) => {
                if changed {
                    self.bump();
                    self.persist_entry(session_id);
                }
                changed
            }
        }
    }

    /// chat 首次 Engage / 补标题的入口（`Silent → Turn`、续聊主链路）。
    ///
    /// - 未置位 ⇒ 置位并按**升序**写入候选（强的自然覆盖弱的）；
    /// - 已置位但**还没有真标题** ⇒ 允许补一次标题（hook 的纯语义事件可能先置位）；
    /// - 已置位且已有标题 ⇒ 什么也不写（续聊不改名、侧栏不闪）。
    ///
    /// `titles` 按**质量升序**给（`Prompt` 在前、`Native` 在后）：顺序即语义，
    /// 「取最强候选」不再需要一个单独的 `pick` —— 它就是 `should_upgrade` 在空条目上的特例。
    ///
    /// 门控在锁内，避免「先读 has_user_input、再写标题」之间的竞态。
    pub fn report_first(&self, session_id: &str, titles: &[(TitleSource, &str)]) -> bool {
        let applied = self.mutate(session_id, |entry| {
            if entry.has_user_input && (titles.is_empty() || has_real_title(entry)) {
                return false;
            }
            let mut changed = false;
            for &(source, text) in titles {
                changed |= upgrade_title(entry, source, text);
            }
            if !entry.has_user_input {
                entry.has_user_input = true;
                changed = true;
            }
            if changed {
                entry.updated_at = Utc::now();
            }
            changed
        });
        self.finish(session_id, applied, "report_first")
    }

    /// 让 `into` 继承 `from` 的身份（标题 / 已使用 / 原生会话 id），并摘掉 `from`。
    ///
    /// 用途：用户点「恢复」之后，新 PTY 是旧会话的**延续**，不是一条新会话。不继承的话，
    /// 新会话要等用户敲第一条输入才会被侧栏列出 —— 表现正是「点了恢复，那一行反而消失了」。
    ///
    /// 两条硬规则：
    /// - `from` 必须是**终止态**：把还活着的会话合并掉，等于让用户点一次就丢一条正在跑的会话；
    /// - 只搬 `into` 缺的字段（新条目本来就是空的），不覆盖它已经拿到的更新事实。
    pub fn adopt(&self, from_session_id: &str, into_session_id: &str) -> bool {
        if from_session_id == into_session_id {
            return false;
        }
        let adopted = {
            let mut sessions = self.guard();
            let Some(from) = sessions.get(from_session_id).cloned() else {
                return false;
            };
            if !from.state.is_terminal() {
                return false;
            }
            let Some(into) = sessions.get_mut(into_session_id) else {
                return false;
            };
            // 标题经**唯一写点**继承：`upgrade_title` 会重跑一次准入 + 覆盖序，
            // 于是「只能在 upgrade_title 一处写 title」这条不变量在继承路径上也成立 ——
            // 直接搬字段会开一条绕过准入的旁路（而单调升级会让旁路的噪声粘住）。
            upgrade_title(into, from.title_source, &from.title);
            if !into.has_user_input && from.has_user_input {
                into.has_user_input = true;
            }
            if into.native_session_id.is_none() {
                into.native_session_id = from.native_session_id;
            }
            sessions.remove(from_session_id);
            true
        };
        if !adopted {
            return false;
        }
        self.bump();
        // 锁外落盘：新行先写、旧行后删。反过来的话，两次写之间崩溃会两行都丢；
        // 这个顺序最坏只留一条可见的陈旧 stopped 行（用户可手动删）。
        let _gate = self.guard_gate();
        self.write_entry(into_session_id);
        if let Err(e) = self.store.delete_cursor(from_session_id) {
            log::warn!("[live_sessions] failed to delete adopted cursor {from_session_id}: {e}");
        }
        true
    }

    /// 记录 agent 侧的原生会话 id（hook 上报携带）。返回「是否真的写了」。
    ///
    /// **不 bump 版本**：这个字段不进 wire 契约（视图不显示、不派生），只有点击恢复时
    /// 后端自己读一次。为一个 UI 看不见的字段刷快照，会让侧栏跟着重渲染。
    ///
    /// 但**必须落盘**（在锁外）：它是重启后 `live_session_resume_command` 读 `--resume`
    /// 参数的唯一来源 —— 不落盘就等于「重启后每次恢复都只能新建终端」。
    ///
    /// 只写一次：CLI 的同一条会话后续 hook 上报里 native id 不会变，重复写是噪声。
    pub fn record_native_session_id(&self, session_id: &str, native_session_id: &str) -> bool {
        let native_session_id = native_session_id.trim();
        if native_session_id.is_empty() {
            return false;
        }
        let written = {
            let mut sessions = self.guard();
            let Some(entry) = sessions.get_mut(session_id) else {
                return false;
            };
            if entry.native_session_id.is_some() {
                return false;
            }
            entry.native_session_id = Some(native_session_id.to_string());
            true
        };
        // 锁外落盘（闸门内重读最新快照）：不 bump（它不进 wire 契约）。
        self.persist_entry(session_id);
        written
    }

    /// 按 id 取一条条目的快照（点击恢复时读 agent / native id / cwd）。
    #[must_use]
    pub fn entry(&self, session_id: &str) -> Option<SessionEntry> {
        self.guard().get(session_id).cloned()
    }

    /// 上报类写入的收尾（锁外）：未知会话记 debug，真变化才 bump 版本、写穿侧栏行。
    ///
    /// 写穿对象是**侧栏列表条目**（标题 / 可见性 / kind / 单元地址 / 原生 id）；未列出
    /// 的会话由 `cursor::from_entry` 的 `has_user_input` 门控直接返回 `None`，调用点不重复判断。
    fn finish(&self, session_id: &str, applied: Option<bool>, op: &str) -> bool {
        match applied {
            None => {
                log::debug!("[live_sessions] {op} for unknown session: {session_id}");
                false
            }
            Some(changed) => {
                if changed {
                    self.bump();
                    self.persist_entry(session_id);
                }
                changed
            }
        }
    }

    /// 尝试升级标题（`should_upgrade` 把关：同级可覆盖，弱级永不覆盖强级）。
    ///
    /// 空白候选直接忽略（不把标题改成空串）；未知会话 `false` + `log::debug!`。
    /// 与「用过」的置位无关 —— 终端 / CLI 的后续标题更新走这里，不经过 [`Registry::report`]。
    pub fn set_title(&self, session_id: &str, source: TitleSource, text: &str) -> bool {
        let applied = self.mutate(session_id, |entry| {
            if !upgrade_title(entry, source, text) {
                return false;
            }
            entry.updated_at = Utc::now();
            true
        });
        self.finish(session_id, applied, "set_title")
    }

    /// 标记应用进入退出流程：之后的 `unregister` 只摘内存条目，不删持久化行。
    ///
    /// 必须在任何清理路径之前置位 —— 只有标志先置好，并发的关闭路径才不会把
    /// 「退出」写成「用户删光了所有会话」。
    pub fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
    }

    /// 注销会话：先摘表（视图立即看不到），再 best-effort 删掉持久化行。
    ///
    /// 删行而不是标 `Closed`：注销 = 「这条会话从侧栏消失」（用户删除 / 进程结束）。
    /// 退出流程例外（[`Registry::begin_shutdown`]）。
    pub fn unregister(&self, session_id: &str) -> bool {
        let removed = self.guard().remove(session_id).is_some();
        if !removed {
            return false;
        }
        self.bump();
        if self.shutting_down.load(Ordering::SeqCst) {
            return true;
        }
        // 锁外落盘：失败只 warn（会话已经不可见了，不该因为库里写失败而卡住注销）。
        // 与 `persist_entry` 共用闸门：已摘掉内存条目的写者拿到闸门后会重读到 `None`，
        // 不会把刚删的行又写回去（“删完又被一个在途旧快照复活”）。
        let _gate = self.guard_gate();
        if let Err(e) = self.store.delete_cursor(session_id) {
            log::warn!("[live_sessions] failed to delete persisted cursor {session_id}: {e}");
        }
        true
    }

    /// 启动恢复：把持久化行投影回侧栏列表，返回**新插入**的条目数。
    ///
    /// 三条约束：
    /// - 状态一律 `Stopped`（见 `cursor::into_entry`）—— 不建 tab、不起进程、不 emit；
    /// - 已在表里的会话**不覆盖**：本次运行拿到的是更新的事实，恢复不该把它退回停止态；
    /// - 不写回库（只读），且整批只 bump 一次（一次插入 = 一次快照变化）。
    pub fn restore_from_store(&self) -> usize {
        let restored: Vec<SessionEntry> = self
            .store
            .list_restorable()
            .iter()
            .filter_map(ResumeCursor::into_entry)
            .collect();
        if restored.is_empty() {
            return 0;
        }
        let inserted = {
            let mut sessions = self.guard();
            let mut inserted = 0;
            for entry in restored {
                if sessions.contains_key(&entry.session_id) {
                    continue;
                }
                sessions.insert(entry.session_id.clone(), entry);
                inserted += 1;
            }
            inserted
        };
        if inserted > 0 {
            self.bump();
        }
        inserted
    }

    /// 快照（wire 前的条目列表）。
    ///
    /// **不做单元过滤**：快照要同时服务三种视图（侧栏按单元、tab 标题、连接页），
    /// 各视图的分组口径不同；过滤与分组统一在前端 selector 里按 `workspaceKey` 等值完成
    /// （红线 12：不拼路径前缀、不比路径）。后端只保证「一份完整、稳定排序的快照」。
    /// 排序：先按单元（`workspace.key()`），单元内按开始时刻倒序，最后用 id 兜底保证稳定。
    #[must_use]
    pub fn snapshot(&self) -> Vec<SessionEntry> {
        let mut entries: Vec<SessionEntry> = self.guard().values().cloned().collect();
        entries.sort_by_cached_key(|entry| {
            (
                entry.workspace.key(),
                std::cmp::Reverse(entry.started_at),
                entry.session_id.clone(),
            )
        });
        entries
    }

    /// 版本未变则挂起，直到版本变化或 `timeout` 到期；返回**当前**版本号。
    ///
    /// 调用方（薄命令）负责默认值与钳制；这里只做语义（超时返回当前版本，不空转）。
    pub async fn wait_for_change(&self, since: u64, timeout: Duration) -> u64 {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let current = self.version();
            if current != since {
                return current;
            }
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return current;
            }
            match tokio::time::timeout(remaining, self.changed.notified()).await {
                Ok(()) => continue,
                Err(_elapsed) => return self.version(),
            }
        }
    }

    /// 锁内对条目做一次修改（唯一入口，保证「锁内只做 map 操作」可审计）。
    fn mutate<R>(&self, session_id: &str, f: impl FnOnce(&mut SessionEntry) -> R) -> Option<R> {
        self.guard().get_mut(session_id).map(f)
    }

    /// 会话表锁：poison 只意味着某个持锁线程 panic，数据仍可用 —— 容忍继续
    /// （与 `AgentChatManager` 同口径；锁中毒不该让整页会话消失）。
    fn guard(&self) -> MutexGuard<'_, HashMap<String, SessionEntry>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// 落盘闸门（poison 容忍口径同上）。
    fn guard_gate(&self) -> MutexGuard<'_, ()> {
        self.persist_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// 版本 +1 并唤醒挂起的长轮询。
    fn bump(&self) -> u64 {
        let next = self.version.fetch_add(1, Ordering::SeqCst) + 1;
        self.changed.notify_one();
        next
    }

    /// 写穿指定会话的当前状态（best-effort，锁外调用）。
    ///
    /// **必须经闸门重新投影**：调用点在锁内算出变化的「结论」，但不携带快照 —— 否则
    /// 并发写者会用更旧的快照覆盖用户改名 / 原生 id（只在重启后可见）。
    fn persist_entry(&self, session_id: &str) {
        let _gate = self.guard_gate();
        self.write_entry(session_id);
    }

    /// 调用方**必须已持有** [`Registry::persist_gate`]：先读最新条目再写。
    fn write_entry(&self, session_id: &str) {
        let cursor = {
            let sessions = self.guard();
            sessions.get(session_id).and_then(ResumeCursor::from_entry)
        };
        self.write_cursor(cursor);
    }

    /// 写穿侧栏条目（best-effort，调用方持有闸门）。
    ///
    /// **创建期定格的字段以库里的旧值为准**，其余字段（标题 / 可见性 / 地址 / 原生 id /
    /// 投影时间）以本次投影为准 —— 否则标题与 native id 永远写不进去。
    ///
    /// 字段清单及其理由在 [`ResumeCursor::with_creation_fields_of`]（与类型同住），本函数
    /// 只负责「读旧值 → 请求合并 → 写」这三步。这是给**任何** `SessionStore` 实现的契约：
    /// 替代实现即使整体覆盖，也不会把用户设置（比如 `confirm` 模式）改回默认值。
    fn write_cursor(&self, cursor: Option<ResumeCursor>) {
        let Some(cursor) = cursor else {
            return;
        };
        let merged = match self.store.load_cursor(&cursor.session_id) {
            Some(existing) => cursor.with_creation_fields_of(&existing),
            None => cursor,
        };
        if let Err(e) = self.store.save_cursor(&merged) {
            log::warn!(
                "[live_sessions] failed to persist cursor {}: {e}",
                merged.session_id
            );
        }
    }
}

/// 升级条目的标题，返回「是否真的改了」。
///
/// **标题的唯一写入点**。规则集中在这里：准入（`title::admit`，什么不配）、截断、
/// 单调升级（`title::should_upgrade`，谁能覆盖谁）、同值不写。调用方只决定
/// 「何时尝试」而不复述规则。
fn upgrade_title(entry: &mut SessionEntry, source: TitleSource, text: &str) -> bool {
    let Some(title) = title::admit(source, text, entry.agent_id.as_deref()) else {
        // 只在「这条会话还没有任何名字」时记一笔：那正是排障「为什么侧栏没名字」
        // 的场景；已有标题时噪声是常态，逐帧记会把日志刷成噪声。
        if entry.title.is_empty() {
            log::debug!(
                "[live_sessions] title candidate rejected ({source:?}): {:?}",
                text.chars().take(32).collect::<String>()
            );
        }
        return false;
    };
    if !title::should_upgrade(entry.title_source, source) {
        return false;
    }
    if entry.title == title && entry.title_source == source {
        return false;
    }
    entry.title = title;
    entry.title_source = source;
    true
}

/// 是否有可展示的真标题。
///
/// 退化为「非空」是因为 [`title::admit`] 对 `Placeholder` 恒返回 `None`：
/// 于是 `title_source == Placeholder ⟺ title.is_empty()` 恒成立。
/// 这条不变量同时让前端的 `isNamedSession` 退化成同一个判据。
const fn has_real_title(entry: &SessionEntry) -> bool {
    !entry.title.is_empty()
}

/// 用户活动解除权威状态门，并把非终止会话推回 Running。
fn mark_entry_user_activity(entry: &mut SessionEntry) -> bool {
    let mut changed = false;
    if !entry.has_user_input {
        entry.has_user_input = true;
        changed = true;
    }
    if entry.awaiting_user_activity {
        entry.awaiting_user_activity = false;
        changed = true;
    }
    if entry.state != SessionState::Running {
        entry.state = SessionState::Running;
        changed = true;
    }
    changed
}

/// 应用一条状态信号并返回 `(是否变化, 是否写穿)`。
fn apply_transition(entry: &mut SessionEntry, signal: Signal) -> (bool, bool) {
    match reduce(entry.state, signal) {
        Some(next) if next != entry.state => {
            entry.state = next;
            entry.updated_at = Utc::now();
            let turn_finished = matches!(signal, Signal::TurnFinished);
            if turn_finished {
                entry.turn_count = entry.turn_count.saturating_add(1);
            }
            // 本函数**只管状态**，而状态列没有真正的读者：启动恢复把每一行都投影成
            // `Stopped`（`cursor::into_entry`），`status` 只服务于兼容旧 chat 语义。
            // 因此只有「顺带记录了别的事实」的转移值得落盘 —— `turn_count`
            // （`TurnFinished` 累计）与终态。
            //
            // 中间态（Running / AwaitingApproval）**不写**：这条路径的高频调用方是
            // chat 的 16ms 合帧 emit 与 PTY 活动 tick，每次转移同步写一次 SQLite 就是
            // 把阻塞调用压在异步执行器 / reader 线程上（红线 3 取向）。标题 / 可见性 /
            // 原生 id 的落盘不在这里，走 report 家族（那边一次变化的收益是永久的）。
            (true, turn_finished || next.is_terminal())
        }
        _ => (false, false),
    }
}

#[cfg(test)]
mod tests;
