# Design — git status 可观测性重构

## 0. 一阶表述

当前实现的全部复杂度都来自一条被写进**数据契约**的资源预算：

> 后端只允许一个 Workspace 处于「被观测」状态（`mount_only` ⇒ `release_except`，决策 D-B）。

UI 契约是「任何 workspace 都能显示」，后端能力是「1 个」。二者不一致 ⇒ 必然产出
「不显示」（能力缺失）与「互踢」（资源震荡）两个症状。九条补偿机制（`prd.md` Background §3）
都是在给这条预算打补丁。

**本设计的判据**：根本性修复以**删除不变量**为标志。若某方案需要新增守卫（最小驻留时间、
重试上限、优先级锁），它就是在补丁层，不是本方案。

三条必须成立的不变量：

- **I1 可观测集合 ⊥ 资源预算**。稀缺只影响调度顺序（先算谁、算多勤），不影响能否显示。
- **I2 读永远权威，事件只是提示**。level-triggered：丢失一次事件不得产生永久空洞。
- **I3 禁止一方维护另一方状态的影子副本**（前端镜像后端挂载态、后端用「已挂载」推断数据新鲜度）。

## 1. 目标架构

三个概念替代 `WatcherManager` 的五份并发状态：

```
┌─ Observe ────────────────────────────────────────────────┐
│ WatchHub: 每 host/卷 1 条流 + PrefixIndex(path → keys)   │
│ 事件 → 打脏（只发信号，不携带事实）                       │
└──────────────────────────┬───────────────────────────────┘
                           │ dirty(WorkspaceKey, Dimension)
┌─ Materialize ────────────▼───────────────────────────────┐
│ RecomputeScheduler: per-key 单飞 + 优先级队列             │
│ 优先级 = 可见集合 > 最近访问 > 其它；有界并发 + 合并去抖   │
└──────────────────────────┬───────────────────────────────┘
                           │ stamped snapshot
┌─ Read ───────────────────▼───────────────────────────────┐
│ StatusStore: key → { snapshot, computed_at, dirty }       │
│ 读 = dirty ? 重算 : 返回；LRU 淘汰 = 「未知」              │
└──────────────────────────────────────────────────────────┘
```

### 1.0 谁需要 push：**实时 ≠ 新鲜**（2026-11-04 决议）

原始方案假设「可见集合里的每个单元都要实时」。这个假设值得拆开看，因为它决定了成本阶数：

| 概念 | 含义 | 成本 | 非激活单元是否需要 |
| --- | --- | --- | --- |
| **实时**（push） | 磁盘一变就推到前端 | 每单元 watcher + worker + 每次事件一轮 `git status` | ❌ **不需要** |
| **新鲜**（read-time truth） | 要看的那一瞬读到的是真的 | 一次 `git status`（普通仓 10–30ms） | ✅ **必需** |

**现场核对（2026-11-04，`rg` 判据）**：侧栏**不显示**任何单元的变更数 ——
`SessionRow` / `WorktreeRowList` / `ProjectGitSection` 对 `selectEntries` / `changed_files` 零命中；
侧栏的 git 显示只有两项：分支名（来自 `project.git_info`，不是 status 快照）与 ↑N 徽标
（`ahead={isActive ? … : undefined}` —— **按设计只在该行是当前视图时显示**）。

⇒ 「非激活项目 git 状态无法显示」的真实含义是「**切过去时**那个项目的 Changes 面板没数据」，
成因是两个已修的缺陷叠加：互踢（C2）与未挂载单元无权威数据（C1）。它**不是**侧栏缺数据。

因此分三层，但**温层当前没有消费者**（是产品可选，不是缺口）：

| 层 | 范围 | 机制 | 目标实时性 | 状态 |
| --- | --- | --- | --- | --- |
| **热** | 同屏**内容**可见的 workspace（典型 1 个；多停靠面板时可能 2 个） | 挂载 watcher + worker，push | <200ms（真 push） | C2 提供能力，C4 提供发送端 |
| **温** | 侧栏可见的其它单元 | **渲染即读**（`get_workspace_status`）+ `dirty`/`STALE_AFTER`；**不挂载** | 「看到时是新的」 | **无消费者** —— 只有将来要在侧栏显示每单元变更数时才需要 |
| **冷** | 其余 | 不读、**不挂载** | — | **C4 补齐**（见下） |

**C2 遗留的缺口：挂载集合无界。** C2 把「挂载即释放其它」删掉后，`ensure_mounted` 只做
「确保」，**从不释放** ⇒ 本次会话访问过的每个 workspace 永久占一套 watcher + worker。
正确的形态是**声明式 reconcile**：`set_visible_workspaces(hotSet)` = 「挂载 hotSet，释放不在
hotSet 里的单元」。这**不是**回到互斥 —— 集合是声明式真值（同一次调用内完成），
而不是「挂一个就踢一个」的竞争。归属：C4（它拥有发送端，且这是同一函数的一处语义收紧）。

**为什么热层仍保留「集合」形状**：典型取值退化为 1，但不能退回单槽 —— 停靠面板可以同屏展示
两个不同 Workspace 的内容（例如左侧 A 项目的 Changes + 底部 B 项目的 Changes），那时两者都该实时。
形状选对、典型值很小，不是 YAGNI；若产品确认「永远只有一处在屏」则应删回单元素（见 C4 prd 的开放问题）。

这条决议直接缩小 C3/C4 的目标：C3 的成本治理只需要服务「热层 + （将来可能的）温层首次读」，
不需要为「N 个常驻实时」设计调度器；C4 从「发送全可见集合」降级为「发送热集合（通常 1 个）
+ 声明式 reconcile（离热即释放）」，**侧栏渲染即读降级为可选**（当前无消费者）。

### 1.1 StatusStore（唯一事实）

```rust
/// 每单元一条。三者同临界区更新（沿用 stamp_and_insert 的原子性纪律）。
struct StatusEntry {
    snapshot: Arc<GitStatusSnapshot>, // version 由 store 统一盖章（沿用现契约）
    computed_at: Instant,             // 新鲜度的唯一真相（新增）
    dirty: DirtyMask,                 // 新增：见 1.2
}

struct StatusStore {
    entries: Mutex<HashMap<WorkspaceKey, StatusEntry>>,
    /// 号源与条目同生命周期 ⇒ version_floors 删除。
    version_seq: Mutex<HashMap<WorkspaceKey, u64>>,
}
```

- `version_floors` 被删的理由：它存在的唯一前提是「释放会丢快照但号段不能退」。store 不再因
  释放丢条目（只有 LRU 淘汰），号段与条目同生共死，**取号 = 条目内 version + 1**。
- `mount_tickets` / `mount_lock` 被删的理由：它们回答「这次写入是否仍有写权」，而该问题只在
  「释放」存在时成立。store 只做 `stamp_and_insert`，写者身份由 scheduler 的 per-key 单飞保证
  （同一 key 同时只有一个重算在飞 ⇒ 天然有序，不需要全局票号）。
- LRU 上限 `MAX_STATUS_ENTRIES_PER_STORE`（如 64 个单元）。淘汰 = 该 key 回到「未知」，
  下次读触发重算 —— **正确性不变，只是多一次 git status**。

### 1.2 脏的最小维度（两条，不是四条）

`DirtyMask { workdir: bool, refs: bool }`。

- `workdir` → 重算 `entries/truncated/branch`（`git status --porcelain`）
- `refs` → 重算 `ahead/behind`（`rev-list`）
- 其余两个输入（`HEAD`、`index`）归入 `workdir`：它们的任何变化都可能改写 porcelain 结果。

**与 `git-domain.md §14` 不冲突**：§14 要求 `ahead/behind` 与 `entries` 必须随**同一个 version**
经**同一条通道**投递 —— 本设计保持这一点（产物仍是单份 `GitStatusSnapshot`）。解耦的只是
**重算触发维度**：refs 变化不必重跑 porcelain，workdir 变化不必重跑 rev-list。两者都仍在
监听集合内（§14 的集合包含关系不变）。若无 upstream/命令失败仍取 `(0,0)`，语义不变。

### 1.3 RecomputeScheduler

```rust
struct RecomputeScheduler {
    /// per-key 单飞：已有在飞任务时只置 dirty 位，不排第二个任务。
    inflight: Mutex<HashSet<WorkspaceKey>>,
    /// 待重算队列：BinaryHeap<(Priority, WorkspaceKey)>，同 key 去重。
    queue: Mutex<BinaryHeap<Queued>>,
    /// 有界并发（跨 host 共享），默认 4。
    permits: Arc<Semaphore>,
    notify: Arc<Notify>,
}
```

- **优先级**：`Hot`（可见集合，含当前视图与展开的侧栏行）> `Warm`（最近 60s 内被读过）> `Cold`（其余）。
  优先级是唯一的成本旋钮，对应 R1.2。
- **合并去抖**：同一 key 的连续脏信号在 80–150ms 窗口内合并（沿用现有 `debounce.rs` 的量级，不新增语义）。
- **过期兜底**：`computed_at` 超过 `STALE_AFTER`（如 30s）且该 key 在 Hot 集合内 ⇒ 强制重算一次。
  这是 I2 的落地：即便某次事件丢失，可见单元也不会无上界陈旧（对应 §14 的「无上界陈旧」禁令）。
- **远端单元**（SSH/WSL）：`Cold` 只按需读，不进队列；`Hot` 由可见集合驱动，走 transport pull。
  `supports_push_producer` 不再是**两条代码路径**的开关，只是「能否被事件打脏」的能力位。

### 1.4 WatchHub（观测层，**2026-11-04 登记为不实现**）

> **前提消失**：本节假设「可见集合里的多个单元都要实时」，因此想把 N 条 per-repo 流收成
> 每 host 一条 + 前缀索引。C4 之后热集合 = 同屏内容可见的单元（典型 1 个），在册挂载 ≈ 1–2 套
> ⇒ 单流化只是把 1 条流换成 1 条流。C3 因此只交付「日志降噪」（`ignore` / `globset` 的逐目录
> DEBUG 不落盘，实测占日志行数 ~20%）。度量与三条理由见 `.trellis/tasks/11-04-watch-hub-single-stream/prd.md`。
> 下面保留原设计，供「将来热集合真的变大」时参考 —— 不要按它直接实现。

```rust
struct WatchHub {
    /// 每 (host, 卷) 一条流。macOS: 1 条 FSEvents 流；Linux: 每条共享 root 一套 inotify 注册。
    streams: HashMap<HostVolume, StreamHandle>,
    /// 前缀索引：sorted segments → WorkspaceKey 集合（长前缀优先匹配）。
    index: RwLock<PrefixIndex>,
    /// 过滤谓词：gitignore 解析结果，按 (root, digest) 缓存。
    filters: RwLock<HashMap<RootId, CachedFilter>>,
}
```

- 事件 → 前缀匹配 → 落在若干 key 上 → `mark_dirty(key, workdir|refs)`。**只发信号**（沿用 §14.3）。
- `.git` 事件归 `refs`（`HEAD`/`refs/`/`packed-refs`/`index`），落在 root 下的普通事件归 `workdir`。
  `.git` 判定沿用现有 `git_meta_merge` 的分类函数（纯函数，已测试）。
- `WatchManifest` 从「挂载步骤」降级为「过滤器构造」，按 `(root, gitignore digest)` 缓存：
  挂载不再遍历整棵树（R4.2）。
- FSEvents 排除根 8 上限：单流模型下不再需要「每个被排除目录一个 root」；排除改为用户态谓词，
  `truncated=true` 消失（R4.3）。

### 1.5 契约变更

| 面 | 现在 | 目标 |
| --- | --- | --- |
| 命令 | `set_active_workspace(workspace) -> WorkspaceActivation` | `set_visible_workspaces(workspaces: Vec<WorkspaceSession>) -> Vec<WorkspaceActivationEntry>`（参数是**热集合** = 同屏内容可见的单元，典型 1 个；不是「侧栏能看到的所有单元」—— 见 §1.0） |
| 命令 | `get_workspace_status(workspace)`：挂载中→快照 / 未挂载→现算 | **签名不变**，语义改为「dirty 则重算，否则返回」 |
| 事件 | `git-status-snapshot`（不变） | 不变（红线 5：不新增事件名） |
| 事件 | `git-changed` | 不变（提示语义保持不变） |
| 后端 | `WatcherManager{watchers, snapshots, version_floors, mount_tickets, ticket_serial, mount_lock}` | `{StatusStore, RecomputeScheduler, WatchHub}` |
| 前端 | `useActiveWorkspaceSync`（reconciliation + retry + 影子记账） | `useVisibleWorkspaces`（只做「热集合 → 命令」的一个 effect，无重试、无记账） + 侧栏**渲染即读**（温层，`refreshWorkspaceStatus`） |

`WorkspaceActivation` 保留（`ready` / `pending`）语义：`pending` 仍然表示「该单元首次重算在途」，
但现在**不影响其它单元**，因此前端不再需要重试环（`get_workspace_status` 对未就绪单元也
返回明确结果：要么现算结果，要么 `pending`）。

## 2. 删除台账（R3.1，实施时逐项勾除）

| # | 删除项 | 落点 | 子任务 |
| --- | --- | --- | --- |
| D1 | `release_except` / `release_except_inner` / `mount_only` | `manager/core.rs:824-845` | C2 |
| D2 | `release_one` 的票号吊销分支与 `drop_snapshot_if_present` 的「作废」语义（保留为 LRU 淘汰） | `manager/core.rs:857-873` | C2 |
| D3 | `mount_tickets` / `MountTicket` / `revoke_ticket_if` / `ticket_serial` | `manager/core.rs` + `handle.rs` | C2 |
| D4 | `version_floors`（并入 `StatusEntry.version`） | `manager/core.rs:130` + `stamp_and_insert` | C2 |
| D5 | `mount_lock` | `manager/core.rs:141` | C2 |
| D6 | `unwatch` / `unwatch_project` 的「释放挂载」语义（改为「从可见集合移除 + 标冷」） | `git/services/status.rs:59-67` | C2 |
| D7 | 前端 `requestedIntent` / `inflightIntent` / `reportedGiveUp` / `retryTick` / `ACTIVATION_RETRY` | `app/hooks/useActiveWorkspaceSync.ts` | C4 |
| D8 | 前端 `useAppShellData.ts:133-145` 回落主仓效果 | `app/hooks/useAppShellData.ts` | C4 |
| D9 | 前端 `useActivateWorkspace` 的 staleness 守卫与 canonical 回写 | `features/git/hooks/useActivateWorkspace.ts:50-68` | C4 |
| D10 | `supports_push_producer` 的双路径分叉（降级为调度策略位） | `git/services/status.rs:231-295` | C2 |
| D11 | `read_mounted_snapshot` 的 Condvar 有界等待（读不再需要等挂载冷窗口；保留单飞等待） | `git/services/status.rs:107-148` | C1 |
| D12 | `ignore::walk` 逐目录 DEBUG 落盘 | `common/file/watcher/manifest.rs` | C3 |

判断标准：**任何一项若被实施者改成「保留 + 加守卫」，视为偏离设计**，需要在 review 中驳回。

## 3. 关键取舍

**为什么不做「共享一个 worker + 轮询所有项目」？**
轮询是真值但延迟无上界且与项目数成线性成本；且它保留「谁在被算」这一稀缺概念，只是把事件
换成定时器 —— 症状会从「永不显示」变成「显示很慢」，I1 仍被违反。

**为什么不用 TTL 缓存代替 dirty？**
TTL 会让「刚改的文件」和「10s 前改的文件」不可区分，且不解决「非可见单元无生产者」；
dirty 是事件驱动的**精确**失效，TTL 只应作为 I2 的兜底（`STALE_AFTER`），不承担主要职责。

**为什么允许 LRU 淘汰却仍要求「永远可答」？**
淘汰后读会触发一次重算，答案是「慢一点的真」，不是「无答案」。这是能力与成本的正交切分：
**能力**（可否显示）恒定，**成本**（这次读多贵）随规模退化。

**为什么不保留 D-B 的最小驻留时间？**
最小驻留时间只能把互踢变慢，且引入「用户切走后必须等 N 秒才释放」的次生问题。互踢的根是
互斥槽位的存在；删掉槽位，互踢在结构上不可能（R5.3）。

## 4. 与既有决策/契约的关系（治理）

- **反转用户决策 D-B**（「每项目同时至多一套挂载资源」）。需要在本任务内同步更新
  `.trellis/spec/backend/git-domain.md §12`，并在该节留下决策反转记录与理由，避免下一个人把它当回归改回去。
- §14 契约**不变**（监听集合 ⊇ 依赖集合；单快照单版本单通道）。本设计只拆重算触发维度。
- 红线 5（事件名常量化）不变：不新增事件名。
- 红线 6（命令层极薄）：`set_visible_workspaces` 只做参数校验 + 调度。
- 红线 3（阻塞 I/O 隔离）：`git status` 仍走 `run_blocking` / worker 线程，调度器不新增阻塞点。
- 红线 10（平台代码落 `platform/`）：单流化的平台差异（FSEvents / inotify / RDCW）全部落
  `platform/watch_backend.rs`，`common/file/watcher/**` 不出现平铺 `#[cfg]`。

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 单流过滤成本上移用户态 | 事件风暴时 CPU 上升 | 前缀索引 + gitignore 谓词缓存 + 80ms 合并去抖；先测后调 |
| 大仓库 `git status` 慢 | 读路径变慢 | `Hot` 限并发；`STALE_AFTER` 只对 Hot 生效；保留 G7 引导 |
| LRU 淘汰导致抖动 | 反复重算 | 上限设 64；淘汰只挑 `Cold` |
| 可见集合过大（同时开 10 个项目） | 并发打满 | `Hot` 并发上限 4 + 队列优先级；溢出降为 `Warm` |
| 迁移期两套模型并存 | 语义漂移 | 子任务按 C1→C4 顺序发布，每步都可独立回滚；不保留长期开关 |

## 6. 迁移与回滚

四步，每步独立可发布、独立可回滚（回滚 = revert 该子树）：

1. **C1**：store 加 `computed_at`/`dirty`，`read_workspace_status` 改为「永远从 store 答」。
   `mount_only` 仍在，但读路径对它透明。**回滚点**：读路径分支。
2. **C2**：`set_active_workspace` → `set_visible_workspaces`；删除 D1–D6、D10。
   **回滚点**：单个 commit，可整体 revert（前端也会回到 C1 的读语义，功能不残缺）。
3. **C3**：`WatchHub` 单流化 + manifest 缓存 + 日志降噪（D12）。
   **回滚点**：`platform/watch_backend.rs` 的流构造；保留 per-repo 流实现直到 C3 验收通过。
4. **C4**：删除前端 D7–D9。

## 7. 新增红线（R6）

> **红线 16（资源稀缺 ⊥ 可观测集合）** —— 资源的稀缺性只允许影响**调度顺序**（先算谁、算多勤），
> 禁止影响**可观测集合**（能不能显示）。任何「至多 N 个 X」的不变量，若 X 是某个 UI 契约的主体，
> 必须写成「至多 N 个**热** X，其余惰性可读」。反例：`release_except` 式的单槽挂载。

> **红线 17（禁止影子副本）** —— 禁止一方维护另一方资源/状态的影子副本。前端若需要知道
> 「后端接管了谁」，那是后端应提供的**读接口**；后端若需要知道「数据是否新鲜」，那是 store 的
> 字段（`computed_at`/`dirty`），不是「是否挂载」。反例：`requestedIntent`、`version_floors`。

**护栏判据**（新增 `tools/guards/checks/check_observability_contract.py`）：

- 生产代码 `.rs` 出现 `release_except` / `mount_tickets` / `version_floors` ⇒ 违规。
- 生产代码 `.ts`/`.tsx` 出现形如 `requestedIntent` / `inflightMount` 的「挂载态镜像」标识符 ⇒ 违规。
- `git/services/status.rs` 的 `read_workspace_status` 不得出现「按是否挂载分支」的结构（AST 判据：函数体里
  不得以 `is_watched` 作为返回路径选择条件）。

## 8. 测试策略

- **纯函数 100%**：`DirtyMask` 合并、`PrefixIndex` 最长前缀匹配、优先级比较、`STALE_AFTER` 判定、
  `refs`/`workdir` 维度归类（复用现有 `git_meta` 分类纯函数）。
- **调度器**（可用假时钟）：同 key 合并、per-key 单飞、Hot 优先、有界并发、LRU 淘汰后读触发重算。
- **store**：`computed_at`/`dirty` 原子更新；读路径「dirty 则重算否则返回」；
  version 单调且不因淘汰回退（淘汰后重新起号必须 > 前端当前值 —— 由断言的**读-重算**路径覆盖）。
- **服务层**（沿用 `CollectingSink` 注入模式）：两个 workspace 同时 Hot ⇒ 两份快照都投递，
  互不影响（这是 AC1/AC2 的代码级闭合，替换现有
  `activate_releases_the_previous_unit` 这条**反方向**断言）。
- **前端**：`useVisibleWorkspaces` 对集合变化只发一次命令（`renderHook` + mock invoke）；
  删除 D7–D9 后对应的旧测试一并删除（不得留「测守卫」的测试）。
- **回归**：`cargo test` 全绿 + `pnpm check:quick` 绿 + 手测 AC7。
