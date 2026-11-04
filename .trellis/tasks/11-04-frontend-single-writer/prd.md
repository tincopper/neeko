# C4 前端单一写者：热集合 reconcile + 删除补偿机制

> 父任务：`.trellis/tasks/11-04-git-status-observability/`
> 架构依据：父任务 `design.md §1.0`（**实时 ≠ 新鲜** + 现场核对 + C2 遗留无界缺口）、§1.5、§2 D7–D9。
> 前置：C1（读路径永权威）、C2（多单元可同时挂载 + `set_visible_workspaces`）已完成。

## Goal

1. 前端只保留**一个**「当前视图是谁」的写者，并把它转成**声明式 reconcile**：
   挂载热集合内的单元、**释放热集合外的单元**（补掉 C2 留下的「挂载集合无界增长」）。
2. 删除为「挂载可能失败 / 被抢」而存在的全部补偿机制。

## Background（现场核对结论，含一次自我更正）

### 侧栏不显示 per-unit 变更数

`rg 'selectEntries|changed_files'` 在 `SessionRow` / `WorktreeRowList` / `ProjectGitSection` /
`ProjectItem` **零命中**。侧栏的 git 显示只有两项：
- 分支名 —— 来自 `project.git_info`（不是 status 快照）；
- ↑N 徽标 —— `ahead={isActive ? … : undefined}`，**按设计只在该行是当前视图时显示**
  （`SessionRow.tsx:185` 有同一道门）。

⇒ 原计划里的「侧栏渲染即读（温层）」**当前没有消费者**。它是「将来想让侧栏显示每单元变更数」
才需要的产品能力，不是本次缺陷的修复项。

### 「非激活项目无法显示」的真实成因

是「**切过去时**那个项目的 Changes 面板没数据」，由两个已修缺陷叠加：
互踢（C2 已修）与未挂载单元无权威数据（C1 已修）。

### C2 留下的现场缺口

C2 删掉「挂载即释放其它」后，`ensure_mounted` 只「确保」、**从不释放** ⇒
本次会话访问过的每个 workspace 永久占一套 watcher + worker + FSEvents 流。
这不是「多挂几个」的规模问题，而是**没有收敛方向**的累积。

### 现状补偿机制（本任务要删的）

`useActiveWorkspaceSync` 的 `requestedIntent` / `inflightIntent` / `reportedGiveUp` / `retryTick` /
`ACTIVATION_RETRY` 预算，以及 `useActivateWorkspace` 的 staleness 守卫、`useAppShellData` 的
「worktrees 不含激活路径 ⇒ 回落主仓」effect —— 全部在补偿「挂载可能不收敛 / 被抢」。
C2 之后「被抢」已不存在（挂载不互斥），重试环因此成了纯粹的自激源。

## Requirements

### R1 声明式 reconcile（P0）

- R1.1 `useActiveWorkspaceSync` → `useVisibleWorkspaces`：一个 effect，输入**热集合**，
  输出一次 `set_visible_workspaces(hotSet)`。
- R1.2 热集合来源 = **内容可见性**：当前激活 tab 所在 workspace + 任何内容同时可见的停靠面板
  所在 workspace。当前实现里后者不存在，集合恒为单元素 —— 允许的退化。
- R1.3 **后端语义收紧为 reconcile**：`set_visible_workspaces` 在挂载 `hotSet` 之后，
  释放**不在** `hotSet` 里的已挂载单元（`unwatch`）。同一次调用内完成，**不是**「挂一个踢一个」。
  释放保留登记表数据（C1 语义：释放 ≠ 作废数据）。
- R1.4 发送去重：集合**不变**时不得重复发命令。判据是 `WorkspaceKey` 排序后的字符串签名，
  不是对象身份（`hook-guidelines.md` 常见错误 5）。
- R1.5 返回载荷处理：`ready` → `applyStatus`；`pending` → 什么也不做（C1 起读路径会给答案）；
  `failed` → 一条 dev 日志（`logFrontendError`），不弹用户可见错误。

### R2 删除补偿机制（P0）

| 删除项 | 落点 |
| --- | --- |
| `requestedIntent` / `inflightIntent` / `reportedGiveUp` / `retryTick` / `ACTIVATION_RETRY` | `app/hooks/useActiveWorkspaceSync.ts` |
| `useActivateWorkspace` 的 staleness 守卫与 canonical 回写 | `features/git/hooks/useActivateWorkspace.ts` |
| 「worktrees 不含激活路径 ⇒ 回落主仓」effect | `app/hooks/useAppShellData.ts:133-145` |

- R2.1 不得以「保留 + 加开关」形式留下（gate G1）。
- R2.2 删除后仍须满足：worktree 被删除 → 激活态回落主仓。触发者改为**用户动作**
  （删除成功后由 `useWorktreeListActions` 已有的 `clearActiveWorkspace`）与**清单读取失败**，
  不再是 render-time 比较。
- R2.3 `set_active_workspace` 命令随之删除（前端不再调用；`git-domain.md §12` 已标注 C4 删除）。

### R3 可选（不在本任务实现，登记以免遗忘）

- R3.1 「侧栏显示每个单元的变更数」需要温层（渲染即读 + `STALE_AFTER` 兜底 + 有界并发 ≤4）。
  当前**无消费者**，不实现；若将来要做，按 `design.md §1.0` 温层定义落地，**不得**把它做成
  「让后端把侧栏所有单元都挂上」（那是把温层错升成热层，成本阶数变回 N 套 watcher）。

### R4 护栏（P1）

- R4.1 新判据（红线 17 的机器判据）：生产前端代码出现「镜像后端资源态」的记账标识符
  （`requestedIntent` / `inflightMount` 类）即违规。
- R4.2 新判据：`refreshWorkspaceStatus` / `get_workspace_status` 的调用点不得出现在
  **每次渲染都会跑**的位置（渲染期裸调用），只能出现在 effect / 事件回调里。

## Acceptance Criteria

- [ ] AC1 切 tab / 切项目时，`[Watcher] ensure mounted N units` 的 N 等于热集合大小（通常 1），
      **不随项目总数增长**；且日志出现对应的 release 行（离热释放）。
- [ ] AC2 驻留验证：访问 6 个不同 workspace 后，`watched_units()` 只剩热集合内的单元
      （≤2），不再随访问历史累积。
- [ ] AC3 热层实时：在当前视图单元改文件，`git-status-snapshot` 在 200ms 内到达
      （沿用后端现有的编辑→推送时延测量）。
- [ ] AC4 非激活项目**切过去即正确**：在别处改了文件，切过去后列表立刻是新的
      （不需要手动刷新、不需要等 TTL）。
- [ ] AC5 `rg 'requestedIntent|ACTIVATION_RETRY|reportedGiveUp|retryTick' src` 为空。
- [ ] AC6 `rg 'set_active_workspace' src` 为空（命令与前端调用同批删除）。
- [ ] AC7 红线 17 护栏接入 `pnpm check:quick`，含正反用例。
- [ ] AC8 `renderHook` 用例：集合去重（同集合不重发）/ 集合变化只发一次 /
      `pending` 不触发任何写入 / `failed` 只记日志。
- [ ] AC9 `pnpm check:quick` 绿。

## 开放问题（需产品确认，不阻塞本任务）

**停靠面板能否同时展示两个不同 Workspace 的 git 内容？**
- 能 ⇒ 热集合保留「集合」形状（AC1 的 ≤2 是常态上限）。
- 不能 ⇒ 应把 `set_visible_workspaces` / `activate_many` / `WorkspaceActivationEntry` 一并删回单元素
  （严格 YAGNI；形状与典型值一致）。

本任务按「保留集合形状」实现 —— 它已存在且无额外成本，删它是纯删除动作，随时可做。

## 非目标

- 不改后端读语义（C1）与多单元挂载能力（C2）。
- 不改观测层流数 / manifest 成本（C3）。
- 不实现温层（R3.1）：当前无消费者。
- 不新增定时器 / 轮询：热集合由视图变化驱动，温层若将来落地也只用 `STALE_AFTER` 兜底。
