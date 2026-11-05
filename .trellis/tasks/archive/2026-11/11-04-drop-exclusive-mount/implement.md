# C2 Implement — 可见集合替换单槽

> 前置：读 `src-tauri/AGENTS.md`；读父任务 `design.md §2` 删除台账；C1 已完成（读路径与挂载解耦）。
> 关键约束：**删除优先**。任何「保留 `release_except` 但加个开关」的写法直接驳回。

## 0. 勘察（开工第一步）

- [ ] `rg -n "release_except|mount_only|mount_lock|watched_units" src-tauri/src`
      —— 列出全部调用点与测试断言（预计：core.rs、status.rs、lifecycle_tests.rs）。
- [ ] `rg -n "set_active_workspace" src src-tauri/src` —— 确认前端唯一调用点在
      `app/hooks/useActiveWorkspaceSync.ts`（C4 才改），后端在 `git/commands/query.rs` + `lib.rs`。
- [ ] `rg -n "watched_units" src-tauri/src` —— 该观测口被多处测试使用，**不要删**。

## 1. `WatcherManager`：`mount_only` → `ensure_mounted`

- [ ] **Red**（`lifecycle_tests`）新增：`mounting_two_units_keeps_both_mounted`
      —— 依次挂载 A、B；断言 `watched_units()` 同时含两者，且 A 的 `is_watched` 仍为 true。
      当前实现下这条必红（B 的挂载会释放 A）。
- [ ] **Green**：`watch()` 出去掉释放逻辑后即可满足（释放只在 `mount_only` 里，属新增调用链）。
- [ ] 新增 `ensure_mounted(&self, units: Vec<(WorkspaceRef, Arc<dyn WatcherEventSink>)>) -> Vec<String>`
      —— 返回本次**新建**挂载的 key 列表（用于日志/测试断言）。内部：
      持 `watch_lock`，对每个单元 `if !is_watched { watch(...) }`。
      `watch()` 自身已有幂等检查，重复调用只打 WARN —— 批量入口必须先判再调，
      否则合法路径会污染「有人绕过入口」这条 WARN 的诊断语义。
- [ ] 删除 `mount_only`、`release_except`、`release_except_inner`。
- [ ] `mount_lock` → 重命名 `watch_lock`，注释改为「`watch()` 的 check-then-insert 原子性」
      （R3.2 的理由写在字段文档里：删掉会重开「同单元两套监听」）。

## 2. 服务层：批量激活

- [ ] 新增 `pub async fn activate_many(state, sink, repos: &[WorkspaceRef])
      -> Result<Vec<(String, WorkspaceActivation)>, AppError>`
      —— 逐单元解析 transport / `supports_push_producer`：
      - Local：`ensure_mounted` 后取首快照（沿用 `first_snapshot_outcome`，冷窗口 = `Pending`）；
      - 远端：不挂载，直接 pull 一次（沿用现逻辑，**不再** `release_except`）。
      - 单单元失败（解析失败 / 非 git 库）**不失败整批**：该项返回错误标记，其余照常。
        （前端能按单元渲染；整批失败会让一个坏项目拖死全部。）
- [ ] `activate_with` 保留（单个单元的编排核心，供 `activate` 与 `activate_many` 复用）。
- [ ] 删除 `activate_with` 里的 `release_except` 调用（两处：远端分支 + 本地分支）。
- [ ] **Red**：`activate_does_not_release_other_units`（服务层，注入 `CollectingSink`）
      —— 先 `activate(A)`，再 `activate(B)`，断言 A 仍在 `watched_units()` 且 A 的槽位未被清。
      当前实现必红。
- [ ] 改写 `activate_releases_the_previous_unit`（正方向的旧不变量）→
      `activate_keeps_previous_unit_mounted`，断言从「只剩 B」翻转为「A 与 B 都在」。

## 3. 命令层

- [ ] 新增 `#[tauri::command] set_visible_workspaces(workspaces: Vec<WorkspaceSession>,
      app: AppHandle, state) -> Result<Vec<WorkspaceActivationEntry>, AppError>`，
      注册进 `lib.rs` 的 `neeko_invoke_handler!`（紧邻 `set_active_workspace`）。
- [ ] `set_active_workspace` 改为薄包装：`vec![workspace]` → `activate_many` → 取第一项。
      注释写明「C4 会删除它，前端将直接发可见集合」。
- [ ] 命令层保持极薄（红线 6）：只解析地址 + 构造 sink + 调度。

## 4. 测试改写（G3：不得留旧不变量的正向断言）

| 旧用例 | 新用例 | 判据变化 |
| --- | --- | --- |
| `activate_style_release_except_keeps_only_the_target_unit` | `mounting_the_target_keeps_every_other_unit` | `watched_units() == [B]` → 含 A、B、other |
| `activate_releases_the_previous_unit` | `activate_keeps_previous_unit_mounted` | 「只挂 B」→「A、B 都在」 |
| `concurrent_mount_*`（若有） | 保留（`watch_lock` 仍负责同 key 原子性） | 不变 |

- [ ] `rg -n "只挂|至多一套|only_the_target" src-tauri/src/common/file/watcher src-tauri/src/git/services`
      —— 清掉描述排他语义的注释（说明「已删除」的地方保留）。

## 5. 验证

```bash
cargo test --lib git::services::status          # 服务层编排
cargo test --lib common::file::watcher          # 生命周期/凭证
cargo clippy --all-targets -- -D warnings
pnpm check:quick                                # 收尾一次
```

- [ ] `rg 'release_except|mount_only' src-tauri/src` 为空（AC3）。
- [ ] 手工核对日志字段：批量挂载记录 `[Watcher] ensure mounted N units (new: …)`。

## 回滚点

- 单 commit 可整体 revert：`watch_lock` 改名可保留（纯命名），`ensure_mounted` 与
  `mount_only` 无并存期。

## 风险

| 风险 | 缓解 |
| --- | --- |
| 前端仍只发单元素集合 ⇒ 非激活单元仍不实时 | 本任务只修互踢；实时性由 C4 落地（AC 已写明） |
| 多单元挂载放大资源（每单元一条 FSEvents 流） | 实测规模小（项目数级）；成本治理在 C3 |
| `ensure_mounted` 批量持 `watch_lock` 拖慢首个单元 | 挂载本就串行（原本也持锁）；单元数 ≤ 十几个 |

---

## 实施结果（已完成）

### 落地清单

| 步 | 落点 | 状态 |
| --- | --- | --- |
| 1 `ensure_mounted`（批量「确保」，不释放） | `manager/core.rs` | ✅ |
| 2 删除 `mount_only` / `release_except` / `release_except_inner` | `manager/core.rs` | ✅ |
| 3 `mount_lock` → `watch_lock`（职责收窄为 check-then-insert） | `manager/core.rs` | ✅ |
| 4 `activate_many` + 删除 `activate_with` 的两处 `release_except` | `git/services/status.rs` | ✅ |
| 5 `set_visible_workspaces` 命令 + `set_active_workspace` 薄包装 | `git/commands/query.rs`、`lib.rs` | ✅ |
| 6 旧测试翻转（不删断言） | `lifecycle_tests.rs`、`git/services/status.rs` | ✅ |
| 7 护栏文案与台账 note 同步 | `check_workspace_identity.py`、`ledger/invariants.json` | ✅ |
| 8 spec 同步（反转记录 + 偏差表） | `git-domain.md §12`、`concurrency-guidelines.md` 契约 3/5/6 | ✅ |

### 与计划的偏差（全部登记进 `git-domain.md §12` 偏差表）

1. **`activate_many` 收 `&[WorkspaceSession]`、返回 `Vec<(String, Result<WorkspaceActivation, AppError>)>`**：
   地址解析失败本身就是**单元级**结局；错误在服务层保持类型化，到命令边界才压成
   `WorkspaceActivationEntry::failed{error: String}`。若按原计划传 `&[WorkspaceRef]`，解析失败
   只能在命令层合并（违反红线 6）或拖死整批。
2. **未给 `WorkspaceActivation` 加 `Failed` 变体**：它是前端已有的 wire 类型
   （`src/shared/types/git.ts`），加变体会让前端 tsc 直接报错，违反「本任务不动前端」。
   批量载荷另立 `WorkspaceActivationEntry`。
3. **删除 `activate_with` 而非保留**：它去掉 `release_except` 后只剩「`has_push_producer` 注入缝」
   这一个测试用途 = 测试专用生产代码。拆成 `mounted_outcome` / `pull_outcome`。
4. **D3（票号）与 D5（挂载锁）保留** —— 父任务删除台账的前提不成立（详见 prd R3）：
   `unwatch` 仍存在；`watch()` 的 check-then-insert 仍需要互斥。
5. **D6（`unwatch` 改「移出可见集合 + 标冷」）不在本任务范围** —— 与 AC4 直接冲突，
   且它会让「已删除单元」的资源长期常驻。留待后续单独立项。

### Red 验证（变异检查）

| 变异 | 变红的用例 |
| --- | --- |
| `ensure_mounted` 恢复「挂载前释放其它单元」 | `mounting_two_units_keeps_both_mounted`、`activate_keeps_previous_unit_mounted` |
| 去掉 `watch_lock` | `concurrent_mount_of_same_unit_creates_exactly_one_watcher_set` |

### 验证记录（主会话独立复跑，不只采信实现者报告）

- `rg 'release_except|mount_only' src-tauri/src` → **空**（AC3）。
- `git status --porcelain src/` → **空**（AC7：前端零改动，`tsc` 通过）。
- `cargo test --lib` → **2586 passed / 0 failed / 9 ignored**。
  （同 C1：临时把别人未提交的 `common/db/migrations.rs` 的 `LATEST_VERSION` 改回 13 才能跑 DB
  夹具；跑完按 sha256 `bd32ae0e…128c6` 还原，未改其内容。）
- `cargo clippy --all-targets -- -D warnings` → 0 诊断。
- `pnpm check:quick` → **35 条护栏全通过**，含 `check_workspace_identity`、`lint_fe`(tsc)、
  `lint_rust_all_targets`。

### 本任务**引入**的缺口（→ C4 收口）

`ensure_mounted` 只确保、不释放 ⇒ 挂载集合无界增长（访问过的每个 workspace 永久占一套资源）。
C4 会把 `set_visible_workspaces` 收紧为**声明式 reconcile**（挂载集合内 + 释放集合外，同一临界区）。
登记在父任务 `design.md §1.0`「C2 遗留的缺口」。

### 本任务**没有**修掉的症状（依赖后续子任务）

- 非激活项目的**实时**刷新：前端目前仍只发单元素集合（`set_active_workspace`），
  所以只有「当前视图那个单元」有 push 生产者。→ **C4**（前端改发可见集合）。
- 但「互踢」已经在结构上消失：即便前端继续发单元素，**挂载 B 不再释放 A**，
  A 的数据与 worker 都保留 —— 日志中的 A/B 交替释放不可能再出现。
