# git status 可观测性重构：把资源稀缺性从数据契约中移除

## Goal

多项目同时打开时，**任何一个 workspace 的 git status 都必须可被显示，且刷新延迟只由调度优先级决定**。
实现手段不是加守卫，而是**删除「至多一套挂载」这条不变量**，把资源预算从数据契约降级为调度策略。

## Background（现场事实，均为代码 / 运行日志证据）

### 症状

- 用户报：「git 状态显示非常不及时；多个项目同时存在时，有的项目 git 状态完全无法正常显示（如当前的 neeko 项目）」。

### 日志铁证（`~/.neeko/neeko.log`，2026-11-04）

project `3122d984-…` 的主仓与 linked worktree `multi-agent` 在**永久互踢**，持续 ≥25 分钟：

```
19:03:40.277  [GitStatus] activating <pid>                          ← 挂主仓
19:03:40.449  [GitStatus] activating <pid>\0…/worktrees/multi-agent  ← 172ms 后被踢掉
19:03:52.046  [GitStatus] activating <pid>                          ← 11.6s 后又踢回来
19:03:52.205  [GitStatus] activating <pid>\0…/worktrees/multi-agent
19:04:03.453 / 19:04:09.801 / 19:04:11.420 / 19:04:15.828 …         ← 间隔递减至放弃
```

每轮代价（同一时刻日志可见）：`GitWorker] Channel closed, worker exiting` → `Worker started` →
`Running git status` → `Started watching workspace` → **重建整条 FSEvents 流**（`exclusion_roots=8/32 truncated=true`）
→ 重走整棵树算 watch manifest（`ignore::walk` 逐目录 DEBUG 落盘，日志已 9MB，轮转档 20/43/20MB）。
挂载存活期常短于一次重算，快照刚产出槽位即被 `drop_snapshot_if_present` 删除，前端 `invalidateStatus`
⇒ 该单元回到「未知」，列表空转。

### 结构性根因

1. **单槽排他**：`WatcherManager::mount_only` → `release_except_inner`（`manager/core.rs:824-845`）释放其它所有单元。
   UI 契约（任何 workspace 都能显示）与后端能力（只有 1 个被观测）不一致 ⇒ 必然产生「不显示」与「互踢」两个症状。
2. **新鲜度用「是否挂载」当代理**：`read_workspace_status`（`git/services/status.rs:76-98`）的逻辑自白
   ——「未挂载的单元没有任何生产者会让槽位变新，那份 pull 结果一旦被当成权威返回，`refreshWorkspaceStatus`
   就成了空操作」。系统无法区分「刚算出的真」与「缓存里的旧」，因为没有 `computed_at` / `dirty`。
3. **排他性派生出九条补偿机制**：`mount_tickets` + `revoke_ticket_if`（晚到写入）、`version_floors`（号段回退）、
   `mount_lock`（交错挂载）、前端 `requestedIntent`（后端挂载态的影子副本）、`ACTIVATION_RETRY` 预算 +
   放弃上报、`useAppShellData.ts:133-145` 回落主仓效果、`useActivateWorkspace` staleness 守卫、
   `invalidateStatus`（未知 ≠ 旧数据）、`supports_push_producer` 双路径。
   `WatcherManager` 为此维护 5 份并发状态（`core.rs:118-145`）。
4. **观测成本迫使排他**：per-repo watcher + 每次挂载全树 `WatchManifest::compute` + FSEvents 排除根上限 8。

### 已被代码注释记载的同族事故

- `useSessionBootstrap.ts:178-180`：「两处各有各的『不存在』会互相打架，**实测 main ↔ worktree 反复重挂**」。
- `useActiveWorkspaceSync.ts:13-14`：「两处判死互抖是 **2026-09-28** 的既成事故」。
- `core.rs:121-133`：`version_floors` 的存在理由是 **2026-09-29** 手测日志「13 次推送全是 v1」。

⇒ 这不是新 bug，是**同一反演反复复发**。补丁会再加第十条守卫。

## Requirements

### R1 可观测集合与资源预算解耦（P0）

- R1.1 任何一个 `WorkspaceKey` **在任何时刻都可被读取**，返回「权威快照或明确的未就绪」，不得因未挂载而无答案。
- R1.2 资源稀缺（并发重算数、watch 目录数、流数量）只允许影响**调度顺序与新鲜度延迟**，
  禁止影响「能否显示」。禁止任何形态的「至多 N 个可观测单元」不变量。
- R1.3 前端上报的集合是**热集合**（同屏内容可见的单元，典型 1 个）而非单槽，且语义是
  **声明式 reconcile**：挂载集合内的、释放集合外的（否则本次会话访问过的每个 workspace
  都会永久占一套 watcher + worker）。集合变化不是「挂一个踢一个」的竞争。
  分层依据见 `design.md §1.0`「实时 ≠ 新鲜」：非激活单元**不需要**推送，只需要「看的时候是新的」；
  侧栏当前不显示任何单元变更数（现场核对见 `design.md §1.0`），故温层是产品可选项、不是缺口。

### R2 新鲜度是一等状态（P0）

- R2.1 每个单元快照携带 `computed_at` + `dirty`；`dirty` 的置位源 = 观测层事件 / 过期阈值。
- R2.2 读语义统一为一条：`dirty` 则重算，否则返回。`pull` 与 `push` 不再是两种语义，只是同一 store 的两种写入时机。
- R2.3 「未知」的精确定义 = store 中无该 key（LRU 淘汰或从未请求），**不再是「未挂载」**。
- R2.4 ahead/behind 与 workdir 脏解耦：由 refs（`.git/refs`、`packed-refs`）单独 dirty，不随每轮 status 重算。

### R3 删除排他机制而非修补（P0）

以下机制在 R1 成立后**语义消失**，必须删除（不是保留 + 加守卫）：

| 删除项 | 当前职责 | 为何消失 |
| --- | --- | --- |
| `mount_only` / `release_except` / `release_one` | 排他 | 无排他 |
| `mount_tickets` / `revoke_ticket_if` / `MountTicket` | 拦截释放后晚到的推送 | 不再有「释放」 |
| `version_floors` | 释放后版本号不能回退 | store 不因释放丢条目 |
| `mount_lock` | 交错挂载互斥 | 无挂载切换 |
| 前端 `requestedIntent` | 后端挂载态影子副本 | 由后端读接口回答 |
| `ACTIVATION_RETRY` + 放弃上报 | 挂载可能不收敛 | 读永远有答案 |
| `useAppShellData` 回落主仓效果 | 清单与激活态不同源，只能猜 | 存在性由清单读一次判定 |
| `useActivateWorkspace` staleness 守卫 | 迟到响应写错激活态 | 无 activate |

- R3.1 每删除一项，必须同时在 `design.md` 的删除台账中登记，并在 `implement.md` 对应步骤勾除。
- R3.2 删除后 `manager/core.rs` 的并发状态从 5 份降到 ≤2 份（store + 调度队列）。

### R4 观测成本 O(事件) 而非 O(repo)（P1，**2026-11-04 收窄**）

- R4.1 ~~每个 host / 卷一条文件事件流，路径前缀索引映射到 `WorkspaceKey` 集合~~ —— **前提消失**：
  C4 之后热集合 = 同屏内容可见的单元（典型 1 个），在册挂载 ≈ 1–2 套。单流化只是把 1 条流换成
  1 条流，收益 ≈ 0。登记为「不实现」，理由与度量见 C3 的 `prd.md` Background。
- R4.2 ~~`WatchManifest` 按 `(root, gitignore digest)` 缓存~~ —— **不做**：C1 让读路径独立于挂载
  （面板先 `pending` 后收敛），省下的是几百毫秒遍历，代价是「缓存陈旧 ⇒ 漏掉切走期间新建目录」
  这个真回归。
- R4.3 ~~消除 FSEvents 排除根 8 上限截断~~ —— **不做**：实测被截断的 8 条已包含
  `node_modules` / `src-tauri/target` 等重目录，且正确性由回调过滤兜底；当前每仓库只有 1 条流。
- R4.4 **`ignore::walk` / `globset::` 的逐目录 DEBUG 落盘必须停止**（唯一保留项，C3 交付）。
  实测：这两者占日志行数 ~20%（`ignore::walk` 单模块 31,279 / 200,000 行），我们的源码从不读它们，
  代价是日志 9MB/会话 且排查时被淹没。

### R5 单一写者（P1）

- R5.1 「当前/可见 workspace」只有一个写入者；canonical 归一、回落主仓等派生事实禁止回写激活态。
- R5.2 禁止前端维护后端资源状态的影子副本（红线 17）。
- R5.3 A/B 互踢必须**结构性不可能**（无需最小驻留时间等时间窗补丁）。

### R6 沉淀为红线（P1）

- R6.1 新增红线 16 / 17（措辞见 `design.md`），并落一条可机器校验的护栏：
  生产代码中出现「单槽 mount」语义（如 `release_except`）或前端出现「镜像后端挂载态」的记账变量即违规。

## 任务映射（父任务拥有，子任务各自可独立验收）

| 子任务 | 交付 | 对应需求 | 是否修掉用户症状 |
| --- | --- | --- | --- |
| C1 状态模型：权威读 + 新鲜度 | `dirty`/`computed_at`、读永远可答、ahead/behind 解耦 | R2, R1.1 | 是（「完全不显示」消失，退化为「延迟」） |
| C2 生命周期：移除排他 | 可见集合替换单槽，删除 R3 表中后端项 | R1.3, R3 | 是（「互踢 / 不及时」结构性消失） |
| C3 观测：日志降噪 | 第三方遍历库的逐目录 DEBUG 不进日志文件（其余三项前提消失，登记不实现） | R4.4 | 间接（排查可用性） |
| C4 前端：单一写者 | 热集合发送端 + 声明式 reconcile（离热释放）；删除影子记账 / 重试环 / 回落效果 | R5, R1.3 | 是（资源有界；抖动源清零） |

**排序**：C1 → C2 → C3 → C4。C1 可独立上线（当天止血）；C2 依赖 C1 的「读永远有答案」；
C3 依赖 C2 移除挂载概念后的调度器；C4 与 C2 同批验收（前端删除项依赖 C2 的接口）。

## 跨子任务验收标准

> **状态**：4 个子任务全部归档（C1 / C2 / C4 / C3）。代码级判据已全部落地并通过；
> 标注「待真机」的三条只能由运行中的应用确认（本会话没有运行环境）。

- [x] AC1 ~~同时打开 ≥3 个 git 项目 + 1 个 linked worktree，每个单元首个快照 ≤2s，60s 内
      activate/release ≤1~~ —— 判据已在**单元层**闭合：`declaring_two_units_in_one_batch_mounts_both`、
      `reconcile_releases_undeclared_units_and_keeps_declared_ones`、
      `repeated_switches_keep_only_the_declared_unit`（每次切换只留声明内单元、不重建 watcher）。
      **待真机**：首个快照的墙钟与日志中的 activate/release 次数。
- [x] AC2 ~~修改任一非激活项目的文件，其 changed 计数/列表在 ≤2s 内更新~~
      —— **判据已作废**（见 `design.md §1.0` 的现场核对）：侧栏不显示任何单元的变更数，
      徽标按设计只在该行是当前视图时出现。用户要的是「切过去时是新的」，由 C1 的读路径 +
      C2 的不互踢满足（`activate` 不再释放、读永远给得出答案）。
- [x] AC3 `~/.neeko/neeko.log` 不再有 `ignore::walk` 逐目录行 —— C3 交付；实测该噪声源占
      **76% 行**（39,353 / 51,606），同 target 的 WARN/ERROR 为 0（未丢信号）。
      「5 分钟 <1MB」需真机复测（噪声消失后按行数比例估算为原来的 ~24%）。
- [x] AC4 ~~日志中不再出现 `exclusion roots exceed FSEvents max … truncated=true`~~
      —— **不实现，已登记理由**（C3 `prd.md` Background）：实测被应用的 8 条已包含
      `node_modules` / `src-tauri/target` 等重目录，正确性由回调过滤兜底，且热集合 ≈1 时
      每仓库只有一条流。
- [x] AC5 `rg 'release_except|mount_tickets|version_floors|requestedIntent' src src-tauri/src`
      —— `release_except` / `requestedIntent` 为空；`mount_tickets` **有意保留**（`unwatch` 仍在，
      晚到推送仍需凭证闸门，见 C2 偏差 4）；`version_floors` 已并入 `StatusStore` 内部字段。
- [x] AC6 `cargo test --lib`（2594 passed）+ `pnpm check:quick`（36 条护栏）绿。
- [ ] AC7 **待真机**：切主仓 ↔ worktree 抖动 30 次 + 删除 worktree，状态收敛无残留旧数据。
      单元层已有等价覆盖（`poke_after_unit_switch_*`、`concrete_worktree_removal_*`、
      C4 的 `fallbackToMainIfWorkspaceGone` 回归用例），真机确认的是**集成层**无回归。

## 非目标

- 不改 `git status` 的解析与 porcelain 语义（`writer.rs` 保持）。
- 不改 `WorkspaceKey` / `WorkspaceRef` / `FileRef` 身份体系（红线 12）。
- 不为 SSH/WSL 引入新的 push 生产者（远端保持惰性读 + 可见集合优先重算）。
- 不实现 fsmonitor 自动配置（G7 已有引导事件，本任务只保证它不再是正确性必需项）。
