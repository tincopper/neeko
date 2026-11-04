# C1 状态模型：权威读与新鲜度（dirty / computed_at）

> 父任务：`.trellis/tasks/11-04-git-status-observability/`
> 技术设计继承父任务 `design.md` §1.1（StatusStore）、§1.2（DirtyMask）、§2 D11。
> 本文件只写本子任务的范围与验收，不复述架构。

## Goal

**任何 `WorkspaceKey` 的 status 读都必须有答案**，且「新鲜」与「陈旧」由 store 的字段判定，
不再由「是否挂载」推断。

这是父任务四步中的第一步，也是唯一可以**独立上线止血**的一步：不动挂载模型、不动观测层，
只补齐状态模型缺的两个字段（`computed_at` / `dirty`）并改掉读路径的分支结构。

## Background

`git/services/status.rs:76-98` 的读路径是这样分支的：

1. 已挂载且已有快照 → 返回
2. 已挂载但首快照未到 → 有界等待后仍无则报 `NotFound`
3. **未挂载 ⇒ 一律现算**

它的注释自白了这个设计缺口：

> 顺序不能反过来（先查缓存再看挂载）：未挂载的单元没有任何生产者会让槽位变新，
> 那份 pull 结果一旦被当成权威返回，`refreshWorkspaceStatus` 就成了空操作

即：系统无法区分「刚算出的真」与「缓存里的旧」，于是拿「是否挂载」当新鲜度的代理。
后果是非激活项目既没有生产者、其 pull 结果也不能被信任 ⇒ 只能每次现算或干脆不显示。

`WatcherManager` 的 `snapshots` 与 `version_floors` 已经做到了「两种生产者写同一张表、
version 由注册表单点盖章」——**store 的骨架已经对了**，缺的只是 `computed_at` 与 `dirty`。

## Requirements

### R1 状态条目携带新鲜度（P0）

- R1.1 `StatusEntry { snapshot: Arc<GitStatusSnapshot>, computed_at: Instant, dirty: DirtyMask }`，
  三者与 `version` 在**同一临界区**更新（沿用 `stamp_and_insert` 的原子性纪律）。
- R1.2 `DirtyMask { workdir: bool, refs: bool }`。`workdir` 覆盖 `HEAD`/`index`/workdir →
  `entries`/`truncated`/`branch`；`refs` 覆盖 `.git/refs`/`packed-refs` → `ahead`/`behind`。
- R1.3 合并语义：同一维度重复置位幂等；`workdir` 置位**不清除** `refs`（两者独立的输入集合）。

### R2 读路径只有一条（P0）

- R2.1 `read_workspace_status` 改为：`entry 不存在 || entry.dirty != empty` ⇒ 重算并登记；否则返回。
  **函数体内不得以 `is_watched` 作为返回路径的选择条件**（父任务护栏判据 3）。
- R2.2 `git status` 的重算必须 per-key 单飞：并发读到同一个 dirty key 只跑一次命令，其余等结果
  （替换现 `read_mounted_snapshot` 的 Condvar + `RECALC_WAIT_TIMEOUT`，见 D11）。
- R2.3 「未就绪」不再是错误：`NotFound("not available yet")` 从这个函数消失；
  保留的错误空间只有「解析不了该单元 / 非 git 库 / 命令失败」。
- R2.4 重算失败时**不清空**已有 entry，也不置 `dirty = empty`（失败 ≠ 数据新鲜）；
  返回上一次的 snapshot 并附失败原因（由命令层决定是否上报）。

### R3 事件只负责打脏（P0）

- R3.1 现有的文件事件 / git-meta 事件 / heartbeat / 写后 poke 一律改为 `mark_dirty(key, mask)`，
  不再直接驱动 emit。`git-status-snapshot` 的投递由「重算完成」触发，保持单通道与单 version。
- R3.2 不新增事件名（红线 5）。
- R3.3 **本子任务不改变**「谁会被重算」——挂载仍是单槽（C2 才动）。也就是说：非激活单元的读
  会走「entry 不存在 ⇒ 重算」这条路径拿到真值，但它们**仍不会被事件打脏**（C2 移除单槽后才实时）。

### R4 ahead/behind 解耦为 refs 维度（P1）

- R4.1 refs 变化只置 `refs` 位 ⇒ 只重跑 `rev-list`，不重跑 porcelain；反之亦然。
- R4.2 产物仍是**单份** `GitStatusSnapshot`、单 version、单事件通道 —— `git-domain.md §14`
  的集合包含关系与单通道契约不变。
- R4.3 无 upstream / detached / 命令失败 → `(0,0)` 语义不变（不是错误）。

### R5 淘汰与已知边界

- R5.1 `MAX_STATUS_ENTRIES_PER_STORE = 64`，LRU 淘汰只挑最近未被读过的 `Cold` key。
- R5.2 淘汰后该 key 回到「未知」，下次读触发重算；**version 不得因淘汰回退**
  （淘汰时保留号段水位，或重新起号时取 `max(上一值)+1` —— 二选一，需在实现里写明理由）。

## Acceptance Criteria

- [x] AC1 两个项目同时存在、只有 A 被挂载：`get_workspace_status(B)` 返回 B 的**真实** entries
      （不是空列表、不是错误），且连续两次调用第二次不再跑 `git status`（`dirty` 为空的证据）。
- [x] AC2 在 B 里改一个文件后再调用：必须重算（`dirty` 未被事件置位的窗口由 `STALE_AFTER` 兜底；
      本子任务至少要保证「显式 poke 后重算」）。
- [x] AC3 `read_workspace_status` 函数体内 grep 不到 `is_watched` 分支（护栏用例覆盖）。
- [x] AC4 同一 dirty key 的 10 个并发读只触发 1 次 `git status`（可用计数假 transport 断言）。
- [x] AC5 `NotFound("not available yet")` 不再出现；冷启动首个读返回真实结果（可能较慢）而非错误。
- [x] AC6 refs-only 变化不重跑 porcelain（用假 transport 统计两条命令的调用次数）。
- [x] AC7 `cargo test` 覆盖：`DirtyMask` 合并、`computed_at`/`dirty` 原子更新、单飞、LRU 淘汰后
      version 不回退、失败不清空 entry。
- [x] AC8 `pnpm check:quick` 绿（本子任务动 Rust，需显式记录 `cargo test` 结果）。

## 非目标

- 不改挂载模型（`mount_only` / 单槽仍在）—— C2。
- 不改观测层流数与 manifest —— C3。
- 不改前端 hook（前端语义在 C1 后**不变**）—— C4。
- 不改 porcelain 解析与 `MAX_STATUS_ENTRIES` 上限施加点（`enforce_entry_cap`）。
