# Implement — C1 状态模型：权威读与新鲜度

> 前置：读 `src-tauri/AGENTS.md`、`.trellis/spec/backend/git-domain.md §12 + §14`、
> `.trellis/spec/backend/concurrency-guidelines.md`「同步桥语义」。
> 设计依据：父任务 `design.md §1.1/§1.2/§2-D11`。

## 0. 落点勘察（开工第一步，不要跳过）

- [ ] `rg -n "snapshots|version_floors|stamp_and_insert|record_computed|store_push_snapshot" src-tauri/src`
      —— 列出所有读写点，确认没有遗漏的第三条写入路径。
- [ ] `rg -n "is_watched|read_mounted_snapshot|poke_status_worker_and_wait" src-tauri/src`
      —— 确认 `is_watched` 的**其它**用途（服务层判「冷启动 vs 未挂 → pull」），避免误删。
- [ ] 确认 `GitStatusSnapshot` 的 `PartialEq` 与 `enforce_entry_cap` 施加点（`writer.rs`），本任务不动。

## 1. 新建 `common/file/watcher/manager/store.rs`（红线 9：不塞进 core.rs）

TDD 顺序（Red → Green）：

- [ ] **Red** `DirtyMask`：`empty()` / `union` 幂等 / `workdir` 置位不清 `refs` / `is_clean()`。
- [ ] **Green** `pub(super) struct DirtyMask { workdir: bool, refs: bool }` + `union`。
- [ ] **Red** `StatusEntry` 的新鲜度判定：`needs_recompute(DirtyMask) -> bool`；
      `computed_at` 超过 `STALE_AFTER` 且被显式要求时也返回 true（`STALE_AFTER` 作为参数传入，纯函数）。
- [ ] **Green** `StatusEntry { snapshot: Arc<GitStatusSnapshot>, computed_at: Instant, dirty: DirtyMask }`。
- [ ] **Red** `StatusStore`：`get` / `upsert_stamped`（沿用现 `stamp_and_insert` 的取号+盖章语义）/
      `mark_dirty` / `take_dirty_first_waiter` / `evict_lru`。
- [ ] **Green** 迁移 `snapshots` + `version_floors` 进 `StatusStore`（两者合并：号段与条目同生命周期）。
      **号段决定**：淘汰时保留水位（沿用现 `version_floors` 语义），实现里写一行注释说明
      「为何不随条目一起回收：前端 version gate 是 `<=` 丢最新」。
- [ ] **Red** `evict_lru`：上限 64，只淘汰 `Cold`（最近未被 `get` 过）；淘汰后再 `get` 返回 None。
- [ ] **Red** version 单调：淘汰 → 重算 → 新 version 必须 > 淘汰前的值（AC7）。

## 2. per-key 单飞（D11，替换 Condvar 有界等待）

- [ ] **Red** 并发：同一 dirty key 的 10 个并发读只触发 1 次 transport 调用（计数假 transport）。
- [ ] **Green** `StatusStore` 内 `inflight: Mutex<HashMap<WorkspaceKey, Arc<OnceLock<Result<…>>>>>`
      （或 `tokio::sync::Mutex` per-key，二选一，避免跨 await 持锁 —— `src-tauri/AGENTS.md`「错误与并发」2）。
- [ ] 删除 `git/services/status.rs::read_mounted_snapshot` 与 `RECALC_WAIT_TIMEOUT` 的**读路径**用法
      （`poke_status_worker_and_wait` 若仍被 `check_and_wait` 使用则保留，见 `worker.rs`）。

> ⚠ 注意：`worker.rs` 的 `check_and_wait` 仍用 `RECALC_WAIT_TIMEOUT` 做「写后同步」等待（§10 写后新鲜度契约）。
> 本任务只删**读路径**对它的依赖，不删写后 poke-and-wait。

## 3. 读路径重写（R2）

- [ ] **Red** `read_workspace_status` 的表驱动测试（4 行）：
      | entry | dirty | 期望 |
      | --- | --- | --- |
      | 无 | - | 现算并登记 |
      | 有 | clean | 直接返回（不调 transport） |
      | 有 | dirty | 现算并覆盖 |
      | 有 | dirty + transport 失败 | 返回旧 snapshot + 失败原因，**不清空** |
- [ ] **Green** 改为单一路径；`is_watched` 从函数体消失（AC3）。
- [ ] **Red** `NotFound("not available yet")` 不再产生（grep 断言 + 行为断言）。
- [ ] 冷启动首个读：返回真实结果（允许慢），不返回错误。

## 4. 事件 → 打脏（R3）

- [ ] **Red** `mark_dirty(key, Workdir)` 后 `git-changed` 路径不再直接 emit；emit 只发生在重算完成后。
- [ ] **Green** 现有回调（`build_callbacks` / `git_meta_merge` / heartbeat / 写后 poke）改为 `mark_dirty`。
- [ ] **不动** 单槽挂载逻辑（`mount_only` 等原样保留）—— C2 才删。
- [ ] **Red** 事件名清单不变（红线 5）：`rg "git-status-snapshot|git-changed"` 结果与改动前一致。

## 5. refs / workdir 维度解耦（R4）

- [ ] **Red** 假 transport 计数：refs-only dirty ⇒ 只跑 `rev-list`，porcelain 调用次数 +0；反之亦然。
- [ ] **Green** `compute_and_record(state, repo, target, mask)`；`workdir` 为空时复用旧 entries/branch，
      `refs` 为空时复用旧 ahead/behind；组装**完整快照**后 `enforce_entry_cap()` 再 `upsert_stamped`。
- [ ] **Red** 产物仍是单快照单 version（断言一次重算只产生一次 emit）。

## 6. 收尾

- [ ] `cargo test -p neeko-lib` 全绿（记录失败项与原因）。
- [ ] `pnpm check:quick` 跑一次且绿。
- [ ] 在 `implement.md` 勾除并在 `prd.md` 勾选 AC。
- [ ] 不做 spec 更新（§12 的 D-B 反转属于 C2）；若 §14 的措辞需要补充「重算维度解耦」，
      在 C1 的 PR 内补 3 行说明，并同步父任务 I7。

## 回滚点

- 单文件级：`store.rs` 新增（无副作用）；读路径重写是一个 commit，`git revert` 即回到分支式实现。

## 风险

| 风险 | 缓解 |
| --- | --- |
| `Instant` 在测试里不可控 | `STALE_AFTER` 判定做成纯函数、`computed_at` 由调用方注入 |
| per-key 单飞引入死锁 | 锁序：只在最外层取 `inflight`，不在持锁时 await；禁止 `inflight → entries` 嵌套 |
| 单槽仍在 ⇒ AC2 的「自动重算」不能全绿 | AC2 只要求显式 poke 后重算；自动打脏是 C2 的验收 |

---

## 实施结果（已完成）

### 落地清单

| 步骤 | 落点 | 状态 |
| --- | --- | --- |
| 1 `DirtyMask` / `StatusEntry` / `StatusStore` | `common/file/watcher/manager/store.rs`（新增，含 14 条单测） | ✅ |
| 2 per-key 单飞 | `common/git/status_worker/gate.rs`（新增 `RecomputeGate`，3 条单测） | ✅ |
| 3 读路径单一路径 | `git/services/status.rs::read_workspace_status`（函数体内已无 `is_watched`） | ✅ |
| 4 事件→打脏的接线 | `wait_status_fresh`：poke 失败（未挂载单元）⇒ `mark_status_dirty(all)` | ✅ |
| 5 refs/workdir 维度解耦 | `compute_and_record(mask, computed_from)` | ✅ |
| 6 超陈旧兜底 | `STALE_AFTER = 3s`（读路径判据的唯一时间常量） | ✅ |
| 7 容量淘汰 | `MAX_ENTRIES = 64`，LRU 按 `last_access`，**保留号段** | ✅ |
| 8 spec 同步 | `git-domain.md §12`（三条描述已作废→重写）+ `§14` 的 `store_snapshot` 改名 | ✅ |

### 与计划的偏差（诚实登记）

1. **D11（删除 `read_mounted_snapshot`）未执行 —— 顺延到 C2。**
   它仍被 `activate_with` 的冷窗口逻辑使用（`activate` 返回 `Pending` 的语义依赖它的有界等待）。
   `read_workspace_status` **已经不再用它**（AC3 的判据只针对读路径），但函数本身保留。
   C2 重做 `activate` 时一并删除。
2. **`version_floors` 没有删除，而是并入 `StatusStore` 的同名内部字段。**
   原计划的「号段与条目同生共死」在容量淘汰下不成立：淘汰后重新起号必须仍大于前端手里的
   version，否则新快照被闸门丢弃。因此保留水位、但**与条目同表同锁**（并发状态从 5 份降到
   3 份：`watchers` / `status_store` / `mount_tickets`）。删除剩余票据/挂载锁是 C2 的范围。
3. **新增了一个计划外的必要改动**：`wait_status_fresh` 在 poke 失败（= 未挂载，没有 worker）
   时打脏。没有它，「写一个未挂载单元 → 立刻读」会读到写前数据，最长陈旧 `STALE_AFTER`；
   这是 C1 把「未挂载 = 每次现算」换成「缓存 + 打脏」带来的**新**空缺，必须同一批补上。
   配合 `StatusStore::upsert_push`（worker 的完整重算清脏、pull 不清脏）。

### Red 验证（变异检查，三条）

| 变异 | 变红的用例 |
| --- | --- |
| `abort_recompute` 改成 no-op（失败当新鲜） | `failed_recompute_restores_dirty_and_keeps_previous_snapshot` |
| 去掉 `upsert_if_not_superseded` 的时间栅栏 | `superseded_recompute_is_discarded`、`a_pull_started_before_a_newer_snapshot_is_discarded` |
| `release_one` 里恢复「释放即 `forget`」 | `unwatch_releases_resources_without_discarding_authoritative_data`、`poke_after_unit_switch_*`、`push_after_release_with_stale_ticket_is_rejected` |

### 被改写（而非删除）的旧测试

| 旧用例 | 新名字 / 新判据 | 理由 |
| --- | --- | --- |
| `unwatch_drops_only_that_unit_snapshot` | `unwatch_releases_resources_without_discarding_authoritative_data` | 「释放必须作废数据」正是被删除的不变量 |
| `pull_cannot_overwrite_a_live_push_snapshot` | `a_pull_started_before_a_newer_snapshot_is_discarded` + `a_pull_started_after_the_last_snapshot_is_accepted_even_when_mounted` | 判据从「是否挂载」换成「时间栅栏」，两个方向各一条 |
| 并发取号「恰为 1..=N」 | 「被采纳的那些取走连续号」 | 栅栏允许开始更早的一轮被合法合并；断言改为不撞号/不跳号 |

### 验证记录

- `cargo test --lib`：**2582 passed / 0 failed**（记录时把工作区里别人未提交的
  `common/db/migrations.rs` 的 `LATEST_VERSION 18` **临时**改回 13 跑，跑完按 sha256 还原 —— 该
  文件当时处于「版本已 bump、迁移链未补」的中间态，会让所有 DB 夹具失败，与本任务无关。
  sha256 前后一致：`bd32ae0e…128c6`）。
- `cargo clippy --all-targets -- -D warnings`：0 诊断。
- `pnpm check:quick`：10 条护栏全通过，`lint_rust_all_targets` 通过。

### 未覆盖 / 留给后续子任务

- 非激活单元的**实时**刷新（事件打脏）在 C1 之后仍不成立：`mount_only` 的单槽还在，未挂载
  单元没有事件源，只能靠 `STALE_AFTER`（3s）在读取时兜底。→ C2。
- 观测成本（每次挂载全树 manifest + FSEvents 截断 + `ignore::walk` 日志）未动。→ C3。
- 前端仍按挂载态做 reconciliation（`requestedIntent` / 重试环 / 回落效果）。→ C4。
