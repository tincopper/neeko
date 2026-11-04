//! 每Workspace的权威 status 登记表：**数据 + 新鲜度 + 号段**同表。
//!
//! 为什么需要这一层（第一性原理）：`status` 是对仓库的投影，缓存新鲜度必须**可判定**。
//! 旧实现没有「这份数据有多新」的字段，只能用「该单元是否挂载」当代理
//! （`git/services/status.rs::read_workspace_status` 旧分支），于是把资源状态混进了数据契约：
//! 未挂载单元的 pull 结果**不能**被信任（无人会让它变新），每次读都必须现算；而现算结果
//! 一旦写成权威快照，下一轮 `refreshWorkspaceStatus` 又成了空操作 —— 两个错误方向互相锁死。
//!
//! 本模块把缺失的那两列补上：`computed_at`（新鲜度的唯一真相）与 `dirty`（失效信号）。
//! 「未知」从此有精确含义 —— **表里没有该 key**，与「是否挂载」无关。
//!
//! 并发纪律（沿用 `stamp_and_insert` 的历史契约，勿动）：取号、盖章、插槽、清脏必须在
//! **同一次持锁**内完成。分成多次持锁时并发生产者能交错出「取小号却后插入」，槽位回退到
//! 旧数据而号段已前进，前端的乱序闸门（`version <= prev` 直接丢弃）无从察觉。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::git::status_worker::GitStatusSnapshot;
use crate::common::git::WorkspaceRef;

/// 读路径的**陈旧上限**（陈旧兜底，不是主通道）。
///
/// 契约（`git-domain.md §14`）：派生值的输入集合必须 ⊆ 被监听/被触发重算的集合，落在集合
/// 之外的输入 = **无上界陈旧**。事件是主通道，但它会丢（inotify 溢出 / FSEvents 延迟聚合 /
/// 单元根本没生产者）。本常量给读路径一个**有界**的陈旧窗口：读到一个比它更旧的条目就重算。
///
/// 取值依据：与 `RECALC_WAIT_TIMEOUT`（1.5s，一次重算的等待预算）同量级但更宽松 ——
/// 太小会把「面板刚渲染、同一帧再读一次」也变成一次 `git status`；太大则可见的陈旧超过
/// 用户可感知的「改完就看见」阈值。
pub(in crate::common::file::watcher) const STALE_AFTER: Duration = Duration::from_secs(3);

/// 登记表容量上限（公理：随输入规模增长的结构必须有界）。
///
/// 淘汰只挑**最久未被读**的条目，且**保留号段水位** —— 淘汰后重新起号必须仍大于前端手里
/// 那份 version，否则「淘汰 → 重算」产出的第一份快照会被前端闸门判成旧的丢掉
/// （2026-09-29 真 app 手测：13 次推送全是 v1）。
pub(in crate::common::file::watcher) const MAX_ENTRIES: usize = 64;

/// 失效维度。刻意只有两位：status 的四个输入按「重算什么命令」归并。
///
/// - `workdir`：`HEAD` / `index` / 工作区 → `entries` / `truncated` / `branch`（`status --porcelain`）
/// - `refs`：`.git/refs` / `packed-refs` → `ahead` / `behind`（`rev-list`）
///
/// 归并依据是**命令**而不是**概念**：HEAD 移动会同时影响分支名与 porcelain 输出，所以它与
/// index/工作区同属一次 `git status`；而 ahead/behind 只依赖 refs，重跑 porcelain 纯属浪费
/// （`git-domain.md §14` 的输入集合包含关系不因此改变：产物仍是**单份**快照、单 version、
/// 单通道，只是重算触发可分开）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DirtyMask {
    /// workdir / index / HEAD 维度失效。
    pub workdir: bool,
    /// refs 维度失效。
    pub refs: bool,
}

impl DirtyMask {
    /// 无维度失效。
    #[must_use]
    pub const fn clean() -> Self {
        Self {
            workdir: false,
            refs: false,
        }
    }

    /// 两个维度都失效（条目不存在时的等价语义：没有任何可复用的输入）。
    #[must_use]
    pub const fn all() -> Self {
        Self {
            workdir: true,
            refs: true,
        }
    }

    /// workdir 维度。
    #[must_use]
    pub const fn workdir() -> Self {
        Self {
            workdir: true,
            refs: false,
        }
    }

    /// refs 维度。
    #[must_use]
    pub const fn refs() -> Self {
        Self {
            workdir: false,
            refs: true,
        }
    }

    /// 是否无维度失效。
    #[must_use]
    pub const fn is_clean(self) -> bool {
        !self.workdir && !self.refs
    }

    /// 合并：幂等，且一个维度置位**不清除**另一位（两者是独立的输入集合）。
    #[must_use]
    pub const fn union(self, other: Self) -> Self {
        Self {
            workdir: self.workdir || other.workdir,
            refs: self.refs || other.refs,
        }
    }
}

/// 一条登记：权威快照 + 它被算出来的时刻 + 最近被读的时刻（LRU 判据）。
struct StatusEntry {
    snapshot: Arc<GitStatusSnapshot>,
    /// 新鲜度的唯一真相（`dirty` 之外的第二判据：事件丢失时由它兜底）。
    computed_at: Instant,
    /// 最近一次被读的时刻（淘汰只按它排，不看 `computed_at` —— 刚算完但没人读的条目
    /// 才是该被淘汰的那个）。
    last_access: Instant,
}

/// 单Workspace维度的权威 status 登记表。
///
/// 三张表而不是一张：`dirty` 必须能在**没有条目**时存在（worker 还没算出首份快照、或条目
/// 已被淘汰时，事件仍然会来；把脏位塞进条目会让它随条目一起消失 ⇒ 丢失一次失效信号）；
/// `version_floors` 必须比条目活得久（见 [`MAX_ENTRIES`] 的说明）。
pub(in crate::common::file::watcher) struct StatusStore {
    entries: HashMap<String, StatusEntry>,
    dirty: HashMap<String, DirtyMask>,
    version_floors: HashMap<String, u64>,
}

impl Default for StatusStore {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusStore {
    /// 空登记表。
    #[must_use]
    pub(in crate::common::file::watcher) fn new() -> Self {
        Self {
            entries: HashMap::new(),
            dirty: HashMap::new(),
            version_floors: HashMap::new(),
        }
    }

    /// 读该单元的权威快照（**不改**访问时刻；LRU 只跟随读路径，见 [`Self::read_snapshot`]）。
    #[cfg(test)]
    #[must_use]
    pub(in crate::common::file::watcher) fn snapshot(
        &self,
        key: &str,
    ) -> Option<Arc<GitStatusSnapshot>> {
        self.entries.get(key).map(|e| Arc::clone(&e.snapshot))
    }

    /// 读路径专用：返回快照并更新 LRU 访问时刻。
    pub(in crate::common::file::watcher) fn read_snapshot(
        &mut self,
        key: &str,
        now: Instant,
    ) -> Option<Arc<GitStatusSnapshot>> {
        let entry = self.entries.get_mut(key)?;
        entry.last_access = now;
        Some(Arc::clone(&entry.snapshot))
    }

    /// 号段水位（测试观测口：断言「淘汰不回收号段」）。
    #[cfg(test)]
    #[must_use]
    pub(in crate::common::file::watcher) fn version_floor(&self, key: &str) -> Option<u64> {
        self.version_floors.get(key).copied()
    }

    /// 再次重算是否值得做（**读路径的唯一判据**，与「是否挂载」无关）。
    ///
    /// 三条任一成立即需要重算：无条目（未知）/ 有脏位（事件失效）/ 超过 [`STALE_AFTER`]
    /// （事件丢失兜底）。
    #[must_use]
    pub(in crate::common::file::watcher) fn needs_recompute(
        &self,
        key: &str,
        now: Instant,
    ) -> bool {
        if self.dirty.contains_key(key) {
            return true;
        }
        match self.entries.get(key) {
            None => true,
            Some(entry) => now.saturating_duration_since(entry.computed_at) >= STALE_AFTER,
        }
    }

    /// 标记失效。条目不存在也可以标记（脏位独立存放）。
    pub(in crate::common::file::watcher) fn mark_dirty(&mut self, key: &str, mask: DirtyMask) {
        if mask.is_clean() {
            return;
        }
        let merged = self
            .dirty
            .get(key)
            .copied()
            .unwrap_or_else(DirtyMask::clean)
            .union(mask);
        self.dirty.insert(key.to_string(), merged);
    }

    /// 取走该单元的脏位（重算开始），返回本轮**必须重算的维度**。
    ///
    /// 判据是「哪些输入不可信」，而不是「有没有脏信号」：
    /// - 无条目 ⇒ [`DirtyMask::all`]（没有可复用的输入）；
    /// - 条目已过 [`STALE_AFTER`] ⇒ [`DirtyMask::all`]（**陈旧是「哪个维度都不可信」**；
    ///   漏掉这一条会得到一个荒谬结果：只把 `computed_at` 刷新而不重算数据 —— 条目从此
    ///   永远「新鲜」但内容是旧的，也就是无上界陈旧）；
    /// - 否则 ⇒ 已记录的脏位（可能为空：调用方刚判过 `needs_recompute`，此时只可能是
    ///   并发的一轮已经把它算新了）。
    ///
    /// **脏位在开始时就清掉**（而不是完成时）：重算期间到达的新事件会重新置位并存活到下一轮 ——
    /// 若在完成时清，就会把「重算开始后发生的变化」一并抹掉（丢更新）。失败路径由
    /// [`Self::abort_recompute`] 把脏位并回去。
    pub(in crate::common::file::watcher) fn begin_recompute(
        &mut self,
        key: &str,
        now: Instant,
    ) -> DirtyMask {
        let dirty = self.dirty.remove(key).unwrap_or_else(DirtyMask::clean);
        match self.entries.get(key) {
            None => DirtyMask::all(),
            Some(entry) if now.saturating_duration_since(entry.computed_at) >= STALE_AFTER => {
                DirtyMask::all()
            }
            Some(_) => dirty,
        }
    }

    /// 重算失败：把本轮的脏位并回去（失败 ≠ 数据新鲜）。已有条目**不清空**。
    pub(in crate::common::file::watcher) fn abort_recompute(&mut self, key: &str, mask: DirtyMask) {
        self.mark_dirty(key, mask);
    }

    /// 登记一份**可能并非最新**的算得结果：若算期间已有更新的登记落地（`computed_at`
    /// 晚于本轮的起点），本次结果作废并返回 `None`。
    ///
    /// 这条栅栏取代了旧实现里「pull 不得覆盖挂载中单元的 push」那条**按挂载态**的守卫
    /// （`store_pull_snapshot`）：现在判据是事实本身（谁的时间戳更新），而不是资源状态。
    /// pull 的 git 子进程耗时以百毫秒计，worker 完全可能在它期间推完一轮 —— 晚到的 pull
    /// 若照常写入，就会拿更大号覆盖更新的数据（前端闸门对这份旧数据只能放行）。
    pub(in crate::common::file::watcher) fn upsert_if_not_superseded(
        &mut self,
        snapshot: GitStatusSnapshot,
        computed_from: Instant,
        now: Instant,
    ) -> Option<Arc<GitStatusSnapshot>> {
        if let Some(entry) = self.entries.get(&snapshot.workspace_key) {
            if entry.computed_at > computed_from {
                return None;
            }
        }
        Some(self.upsert(snapshot, now))
    }

    /// 登记一份 **push（worker）产出**的快照：与 [`Self::upsert`] 相同，但**清掉脏位**。
    ///
    /// 为什么 push 可以清、pull 不能：worker 的每一轮**完整覆盖两个维度**（porcelain +
    /// branch + ahead/behind），所以它产出的数据对两个维度都是新鲜的；而 pull 的两个维度是
    /// 分别条件计算的（`DirtyMask`），清脏必须在 `begin_recompute` 取走时完成。
    ///
    /// 且「算期间到达的事件」不会在这里被吃掉：那些事件同时会 signal worker / scheduler
    /// （`ThrottleScheduler` 通道），而脏位只服务于**读路径**的成本判断 —— 丢一个脏位最多让
    /// 下一次读少算一轮，不会让数据停在旧值上。
    pub(in crate::common::file::watcher) fn upsert_push(
        &mut self,
        snapshot: GitStatusSnapshot,
        now: Instant,
    ) -> Arc<GitStatusSnapshot> {
        self.dirty.remove(&snapshot.workspace_key);
        self.upsert(snapshot, now)
    }

    /// 登记一份权威快照：取号 + 盖章 + 插槽 + 淘汰（同一临界区内完成）。
    pub(in crate::common::file::watcher) fn upsert(
        &mut self,
        mut snapshot: GitStatusSnapshot,
        now: Instant,
    ) -> Arc<GitStatusSnapshot> {
        let key = snapshot.workspace_key.clone();
        // 号段取自水位而非槽位：条目被淘汰/作废后重新起号必须仍大于前端手里的 version
        // （否则「淘汰 → 重算」的第一份快照会被前端 `version <= prev` 判成旧的丢掉）。
        let in_slot = self.entries.get(&key).map_or(0, |e| e.snapshot.version);
        let next = self
            .version_floors
            .get(&key)
            .copied()
            .unwrap_or(0)
            .max(in_slot)
            + 1;
        self.version_floors.insert(key.clone(), next);
        snapshot.version = next;
        let arc = Arc::new(snapshot);
        self.entries.insert(
            key.clone(),
            StatusEntry {
                snapshot: Arc::clone(&arc),
                computed_at: now,
                last_access: now,
            },
        );
        self.evict_over_cap(&key);
        arc
    }

    /// 作废某单元的**数据**（保留号段水位）：语义是「此刻没有权威数据」。
    ///
    /// 只在「该单元确实不再存在」时调用（项目移除 / worktree 删除）。单纯的「切走视图」
    /// **不得**作废 —— 那正是旧实现里「未挂载 = 无权威数据」把资源状态混进数据契约的入口。
    pub(in crate::common::file::watcher) fn forget(&mut self, key: &str) {
        self.entries.remove(key);
        self.dirty.remove(key);
    }

    /// 项目被移除：数据与号段一并回收（该项目的单元不会再有读者）。
    ///
    /// 与 [`Self::forget`] 的差别只在号段：单元级的「切走视图」必须保留号段（否则重新挂载的
    /// 第一份快照会被前端闸门判成旧的丢掉），而项目级移除没有这个约束。
    pub(in crate::common::file::watcher) fn forget_project(&mut self, project_id: &str) {
        let owned: Vec<String> = self
            .entries
            .keys()
            .chain(self.dirty.keys())
            .chain(self.version_floors.keys())
            .filter(|key| WorkspaceRef::parse_key(key).is_some_and(|(pid, _)| pid == project_id))
            .cloned()
            .collect();
        for key in owned {
            self.entries.remove(&key);
            self.dirty.remove(&key);
            self.version_floors.remove(&key);
        }
    }

    /// 容量淘汰：超过 [`MAX_ENTRIES`] 时按最近访问时刻淘汰，**绝不淘汰刚插入的那条**。
    fn evict_over_cap(&mut self, keep: &str) {
        while self.entries.len() > MAX_ENTRIES {
            let victim = self
                .entries
                .iter()
                .filter(|(key, _)| key.as_str() != keep)
                .min_by_key(|(_, entry)| entry.last_access)
                .map(|(key, _)| key.clone());
            match victim {
                Some(key) => {
                    self.entries.remove(&key);
                }
                // 全是 keep（容量上限为 0 的病态配置）：无处可淘汰，退出避免死循环。
                None => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> WorkspaceRef {
        WorkspaceRef::main("p1", "/tmp/p1")
    }

    fn snapshot(version: u64) -> GitStatusSnapshot {
        GitStatusSnapshot::for_unit(&repo(), version)
    }

    fn key() -> String {
        repo().key()
    }

    #[test]
    fn dirty_mask_union_is_idempotent_and_keeps_both_dimensions() {
        let a = DirtyMask::workdir();
        assert_eq!(a.union(a), DirtyMask::workdir());
        assert_eq!(a.union(DirtyMask::refs()), DirtyMask::all());
        assert!(DirtyMask::clean().is_clean());
        assert!(!DirtyMask::refs().is_clean());
        // workdir 置位不得清除 refs（两者是独立的输入集合）
        assert_eq!(
            DirtyMask::all().union(DirtyMask::workdir()),
            DirtyMask::all()
        );
    }

    #[test]
    fn missing_entry_always_needs_recompute() {
        let store = StatusStore::new();
        assert!(store.needs_recompute(&key(), Instant::now()));
        assert!(store.snapshot(&key()).is_none());
    }

    #[test]
    fn fresh_clean_entry_does_not_need_recompute() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);
        assert!(!store.needs_recompute(&key(), now));
        assert_eq!(store.snapshot(&key()).map(|s| s.version), Some(1));
    }

    #[test]
    fn stale_entry_needs_recompute_even_without_dirty_signal() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);
        assert!(!store.needs_recompute(&key(), now));
        // 事件丢了也要收敛：陈旧窗口到期即重算（§14「无上界陈旧」禁令的兜底）
        assert!(store.needs_recompute(&key(), now + STALE_AFTER));
        assert!(store.needs_recompute(&key(), now + STALE_AFTER + Duration::from_millis(1)));
    }

    #[test]
    fn dirty_signal_forces_recompute_and_survives_without_entry() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        // 条目不存在也能记脏（worker 首份快照未到 / 已被淘汰）
        store.mark_dirty(&key(), DirtyMask::refs());
        assert!(store.needs_recompute(&key(), now));
        store.upsert(snapshot(0), now);
        // 登记不清脏位（脏位只在 begin_recompute 时被取走）
        assert!(store.needs_recompute(&key(), now));
    }

    #[test]
    fn begin_recompute_takes_dirty_and_reports_all_when_absent() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        assert_eq!(store.begin_recompute(&key(), now), DirtyMask::all());

        store.upsert(snapshot(0), now);
        assert_eq!(store.begin_recompute(&key(), now), DirtyMask::clean());

        store.mark_dirty(&key(), DirtyMask::refs());
        assert_eq!(store.begin_recompute(&key(), now), DirtyMask::refs());
        // 取走后干净
        assert_eq!(store.begin_recompute(&key(), now), DirtyMask::clean());
    }

    /// **陈旧 ⇒ 两个维度都必须重算**。漏掉这条会得到「只刷新 `computed_at`、不重算数据」：
    /// 条目从此永远「新鲜」但内容是旧的，即 §14 明令禁止的无上界陈旧。
    #[test]
    fn stale_entry_recomputes_both_dimensions_even_without_dirty_signal() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);
        assert_eq!(
            store.begin_recompute(&key(), now + STALE_AFTER),
            DirtyMask::all(),
            "过陈旧窗口的条目两个维度都不可信"
        );
    }

    #[test]
    fn events_arriving_during_recompute_survive_to_next_round() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);
        store.mark_dirty(&key(), DirtyMask::workdir());

        // 重算开始（取走脏位）
        assert_eq!(store.begin_recompute(&key(), now), DirtyMask::workdir());
        // 算期间又有事件到达
        store.mark_dirty(&key(), DirtyMask::refs());
        // 登记不清脏位 ⇒ 新一轮仍会看到 refs
        store.upsert(snapshot(1), now + Duration::from_millis(100));
        assert!(store.needs_recompute(&key(), now + Duration::from_millis(100)));
        assert_eq!(
            store.begin_recompute(&key(), now + Duration::from_millis(100)),
            DirtyMask::refs()
        );
    }

    #[test]
    fn push_upsert_clears_dirty_but_pull_upsert_does_not() {
        let now = Instant::now();
        let mut store = StatusStore::new();

        // push：worker 的完整重算 ⇒ 脏位被清除
        store.mark_dirty(&key(), DirtyMask::all());
        store.upsert_push(snapshot(0), now);
        assert!(
            !store.needs_recompute(&key(), now),
            "worker 的完整重算必须把脏位清掉（否则后续每次读都白算一轮）"
        );

        // pull：脏位在 begin_recompute 取走，登记（`upsert`）本身不改脏位
        store.mark_dirty(&key(), DirtyMask::refs());
        store.upsert(snapshot(0), now + Duration::from_millis(1));
        assert!(
            store.needs_recompute(&key(), now + Duration::from_millis(1)),
            "pull 的登记不得清脏（它可能只覆盖了一个维度）"
        );
    }

    #[test]
    fn failed_recompute_restores_dirty_and_keeps_previous_snapshot() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);
        let mask = store.begin_recompute(&key(), now);
        assert!(mask.is_clean());
        store.abort_recompute(&key(), DirtyMask::workdir());
        // 失败 ≠ 新鲜：脏位回来，且旧条目还在（不清空）
        assert!(store.needs_recompute(&key(), now));
        assert_eq!(store.snapshot(&key()).map(|s| s.version), Some(1));
    }

    #[test]
    fn version_is_stamped_monotonically_and_overrides_producer_value() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        assert_eq!(store.upsert(snapshot(0), now).version, 1);
        // 生产者自带 version 不作数（号源只有登记表一个）
        assert_eq!(store.upsert(snapshot(99), now).version, 2);
    }

    #[test]
    fn superseded_recompute_is_discarded() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        store.upsert(snapshot(0), now);

        // 一轮 pull 在 t0 开始，期间 worker 推了一份更新的
        let started = now;
        store.upsert(snapshot(0), now + Duration::from_millis(50));
        let discarded =
            store.upsert_if_not_superseded(snapshot(0), started, now + Duration::from_millis(200));
        assert!(discarded.is_none(), "晚到的 pull 不得覆盖更新的登记");
        assert_eq!(store.snapshot(&key()).map(|s| s.version), Some(2));

        // 没有更新的登记时正常写入
        let started = now + Duration::from_millis(300);
        let accepted =
            store.upsert_if_not_superseded(snapshot(0), started, now + Duration::from_millis(400));
        assert_eq!(accepted.map(|s| s.version), Some(3));
    }

    #[test]
    fn forget_clears_data_but_keeps_version_floor() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        assert_eq!(store.upsert(snapshot(0), now).version, 1);
        assert_eq!(store.upsert(snapshot(0), now).version, 2);
        store.forget(&key());
        assert!(store.snapshot(&key()).is_none());
        assert_eq!(store.version_floor(&key()), Some(2));
        // 「作废 → 重算」产出的第一份快照必须仍大于前端手里的 2（否则被闸门丢掉）
        assert_eq!(store.upsert(snapshot(0), now).version, 3);
    }

    #[test]
    fn eviction_keeps_floors_and_never_drops_the_newest_entry() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        // 灌满 + 超出上限
        for i in 0..=MAX_ENTRIES {
            let mut snap = snapshot(0);
            snap.workspace_key = format!("k{i}");
            store.upsert(snap, now + Duration::from_millis(u64::try_from(i).unwrap()));
        }
        assert_eq!(store.entries.len(), MAX_ENTRIES);
        // 刚插入的在册
        assert!(store.snapshot(&format!("k{MAX_ENTRIES}")).is_some());
        // 最久未读的被淘汰
        assert!(store.snapshot("k0").is_none());
        // 号段水位不受淘汰影响
        assert_eq!(store.version_floor("k0"), Some(1));
    }

    #[test]
    fn eviction_prefers_least_recently_read_over_least_recently_computed() {
        let now = Instant::now();
        let mut store = StatusStore::new();
        // 填满
        for i in 0..MAX_ENTRIES {
            let mut snap = snapshot(0);
            snap.workspace_key = format!("k{i}");
            store.upsert(snap, now + Duration::from_millis(u64::try_from(i).unwrap()));
        }
        // 读一下最老的：它不该再是淘汰对象
        let _ = store.read_snapshot("k0", now + Duration::from_secs(1));
        // 再插入一条触发淘汰
        let mut snap = snapshot(0);
        snap.workspace_key = "fresh".to_string();
        store.upsert(snap, now + Duration::from_secs(2));

        assert!(store.snapshot("k0").is_some(), "刚读过的条目不该被淘汰");
        assert!(store.snapshot("k1").is_none(), "最久未读的才是淘汰对象");
    }
}
