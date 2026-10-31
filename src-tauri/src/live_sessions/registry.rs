//! Live session 注册表：**内存唯一事实** + 写穿持久化。
//!
//! # 不变量
//!
//! 1. 状态只能经信号改变：写入面只有 [`Registry::apply`]（外加 `register` / `unregister`
//!    这两个生命周期动作）。视图层拿不到 `&mut SessionEntry`。
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
use crate::live_sessions::entry::{SessionEntry, TitleSource};
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

    /// 应用一条信号。返回「状态是否真的变了」（调用方据此决定是否发变更事件）。
    ///
    /// 未知会话 → `false` + `log::debug!`（不建条目）；状态未变 / 信号被吸收 → `false`。
    pub fn apply(&self, session_id: &str, signal: Signal) -> bool {
        // 外层 `None` = 会话未知；内层 `None` = 状态未变（含终止吸收）。
        let outcome = self.mutate(session_id, |entry| match reduce(entry.state, signal) {
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
                Some(if turn_finished || next.is_terminal() {
                    ResumeCursor::from_entry(entry)
                } else {
                    None
                })
            }
            _ => None,
        });
        match outcome {
            None => {
                log::debug!("[live_sessions] dropped {signal:?} for unknown session: {session_id}");
                false
            }
            Some(None) => false,
            Some(Some(cursor)) => {
                self.bump();
                self.persist(cursor);
                true
            }
        }
    }

    /// 尝试升级标题（`should_upgrade` 把关：同级可覆盖，弱级永不覆盖强级）。
    ///
    /// 空白候选直接忽略（不把标题改成空串）；未知会话 `false` + `log::debug!`。
    pub fn set_title(&self, session_id: &str, source: TitleSource, text: &str) -> bool {
        let title = title::truncate(text, title::MAX_TITLE_CHARS);
        if title.is_empty() {
            return false;
        }
        let applied = self.mutate(session_id, |entry| {
            if !title::should_upgrade(entry.title_source, source) {
                return false;
            }
            if entry.title == title && entry.title_source == source {
                return false;
            }
            entry.title = title;
            entry.title_source = source;
            entry.updated_at = Utc::now();
            true
        });
        let Some(changed) = applied else {
            log::debug!("[live_sessions] set_title for unknown session: {session_id}");
            return false;
        };
        if changed {
            // 标题不落 cursor（`ResumeCursor` 没有标题列）⇒ 只有版本通知。
            self.bump();
        }
        changed
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

#[cfg(test)]
mod tests;
