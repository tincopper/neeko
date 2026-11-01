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
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// 版本变更唤醒器（credit-pull：前端挂起等版本，不推全量快照）。
    ///
    /// 用 `notify_one`（无 waiter 时存一个 permit）而不是 `notify_waiters`：
    /// 「检查版本 → 注册 waiter」之间的竞态窗口由 permit 覆盖，代价至多多循环一次。
    changed: tokio::sync::Notify,
    /// 持久化后端（chat 会话的恢复游标；terminal 不落盘）。
    store: Arc<dyn SessionStore>,
}

impl Registry {
    /// 用既有 `SessionStore` 构造空注册表（与 `AgentChatManager` 共用同一实例）。
    #[must_use]
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            version: AtomicU64::new(0),
            changed: tokio::sync::Notify::new(),
            store,
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
        let (duplicate, cursor) = {
            let mut sessions = self.guard();
            let duplicate = sessions.contains_key(&entry.session_id);
            sessions.insert(entry.session_id.clone(), entry.clone());
            (duplicate, ResumeCursor::from_entry(&entry))
        };
        if duplicate {
            log::warn!(
                "[live_sessions] duplicate session id registered, overriding: {}",
                entry.session_id
            );
        }
        self.bump();
        self.persist(cursor);
        !duplicate
    }

    /// 只在会话**尚未登记**时登记，返回「是否新增」（`false` = 已存在，**什么都没写**）。
    ///
    /// 与 [`Registry::register`] 的差别有两个：不覆盖既有条目、不为重复 id 记 warn 也不 bump。
    /// 「登记 = 首次出现」这条判据只在锁内成立一次 —— 判据与写入必须同一个临界区，
    /// 否则 `contains` 之后、`register` 之前插进来的条目会被静默覆盖。
    pub fn register_if_absent(&self, entry: SessionEntry) -> bool {
        let cursor = {
            let mut sessions = self.guard();
            if sessions.contains_key(&entry.session_id) {
                return false;
            }
            let cursor = ResumeCursor::from_entry(&entry);
            sessions.insert(entry.session_id.clone(), entry);
            cursor
        };
        self.bump();
        self.persist(cursor);
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
        // 外层 `None` = 会话未知；内层 `(changed, cursor)` = 状态是否变、是否写穿。
        let outcome = self.mutate(session_id, |entry| {
            if from_activity
                && entry.awaiting_user_activity
                && matches!(signal, Signal::TurnStarted | Signal::TurnFinished)
            {
                return (false, None);
            }
            apply_transition(entry, signal)
        });
        match outcome {
            None => {
                log::debug!("[live_sessions] dropped {signal:?} for unknown session: {session_id}");
                false
            }
            Some((changed, cursor)) => {
                if changed {
                    self.bump();
                    self.persist(cursor);
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
            if !has_real_title(entry) && !title.trim().is_empty() {
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
            let (state_changed, cursor) = apply_transition(entry, signal);
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
            (changed, cursor)
        });
        match outcome {
            None => {
                log::debug!(
                    "[live_sessions] authoritative event for unknown session: {session_id}"
                );
                false
            }
            Some((changed, cursor)) => {
                if changed {
                    self.bump();
                    self.persist(cursor);
                }
                changed
            }
        }
    }

    /// chat 首次 Engage / 补标题的入口（`Silent → Turn`、续聊主链路）。
    ///
    /// - 未置位 ⇒ 置位并写入首个标题；
    /// - 已置位但**还没有真标题** ⇒ 允许补一次标题（hook 的纯语义事件可能先置位）；
    /// - 已置位且已有标题 ⇒ 什么也不写（续聊不改名、侧栏不闪）。
    ///
    /// 门控在锁内，避免「先读 has_user_input、再写标题」之间的竞态。
    pub fn report_first(&self, session_id: &str, title: Option<(TitleSource, &str)>) -> bool {
        let applied = self.mutate(session_id, |entry| {
            if entry.has_user_input && (title.is_none() || has_real_title(entry)) {
                return false;
            }
            let mut changed = false;
            if let Some((source, text)) = title {
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

    /// 上报类写入的收尾（锁外）：未知会话记 debug，真变化才 bump 版本并唤醒长轮询。
    ///
    /// 不写穿 `ResumeCursor`：标题与可见性都不落库（`cursor::from_entry` 没有这两列），
    /// 重启后的可见性由登记时的形态重新决定。
    fn finish(&self, session_id: &str, applied: Option<bool>, op: &str) -> bool {
        match applied {
            None => {
                log::debug!("[live_sessions] {op} for unknown session: {session_id}");
                false
            }
            Some(changed) => {
                if changed {
                    self.bump();
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

    /// 注销会话：先摘表（视图立即看不到），再 best-effort 关闭持久化游标。
    pub fn unregister(&self, session_id: &str) -> bool {
        let removed = self.guard().remove(session_id).is_some();
        if !removed {
            return false;
        }
        self.bump();
        // 锁外落盘：失败只 warn（会话已经不可见了，不该因为库里写失败而卡住注销）。
        if let Err(e) = self.store.close_session(session_id) {
            log::warn!("[live_sessions] failed to close persisted cursor {session_id}: {e}");
        }
        true
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

    /// 版本 +1 并唤醒挂起的长轮询。
    fn bump(&self) -> u64 {
        let next = self.version.fetch_add(1, Ordering::SeqCst) + 1;
        self.changed.notify_one();
        next
    }

    /// 写穿恢复游标（best-effort，锁外调用）。
    ///
    /// **只覆盖注册表知道的字段**（status / turn_count / last_activity）：
    /// `model` / `runtime_mode` 由创建期写入的 cursor 保留（`build_resume_cursor` 携带用户的
    /// `confirm` 模式）。用投影整体覆盖会把用户设置静默改写回 `auto`。
    fn persist(&self, cursor: Option<ResumeCursor>) {
        let Some(cursor) = cursor else {
            return;
        };
        let merged = match self.store.load_cursor(&cursor.session_id) {
            Some(mut existing) => {
                existing.status = cursor.status;
                existing.turn_count = cursor.turn_count;
                existing.last_activity = cursor.last_activity;
                existing
            }
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
/// 规则集中在这里（截断 + 空白忽略 + 单调升级 + 同值不写）：`set_title`、`report`、
/// `report_first` 三个入口共用同一份判据，调用方只决定「何时尝试」而不复述规则。
fn upgrade_title(entry: &mut SessionEntry, source: TitleSource, text: &str) -> bool {
    let title = title::truncate(text, title::MAX_TITLE_CHARS);
    if title.is_empty() || !title::should_upgrade(entry.title_source, source) {
        return false;
    }
    if entry.title == title && entry.title_source == source {
        return false;
    }
    entry.title = title;
    entry.title_source = source;
    true
}

/// 是否有可展示的真标题（空串与占位来源都不算）。
fn has_real_title(entry: &SessionEntry) -> bool {
    !entry.title.trim().is_empty() && entry.title_source != TitleSource::Placeholder
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
fn apply_transition(entry: &mut SessionEntry, signal: Signal) -> (bool, Option<ResumeCursor>) {
    match reduce(entry.state, signal) {
        Some(next) if next != entry.state => {
            entry.state = next;
            entry.updated_at = Utc::now();
            let turn_finished = matches!(signal, Signal::TurnFinished);
            if turn_finished {
                entry.turn_count = entry.turn_count.saturating_add(1);
            }
            // 只在「DB 读者真的会读到」的变化上写穿：`turn_count` 与终态
            // （`SessionStore::list_active` 按 `status != Closed` 过滤）。中间态
            // （Running / AwaitingApproval）重启后没有任何代码读回 live 条目，
            // 而每次转移都同步写一次 SQLite 会把这些写压在异步执行器线程上
            // （红线 3 取向）。
            (
                true,
                if turn_finished || next.is_terminal() {
                    ResumeCursor::from_entry(entry)
                } else {
                    None
                },
            )
        }
        _ => (false, None),
    }
}

#[cfg(test)]
mod tests;
