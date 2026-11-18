# 侧栏点击行未切激活项目（跨项目按了没反应）

## Goal

侧栏列出**所有**项目的单元与会话，但点其中一行只激活「单元」，**不切激活项目**。于是从项目 B 的
行点下去，tab 在 B 的 tab 空间里被激活、单元状态也切了，而中心视图仍停在项目 A —— 表现就是
用户说的「点了没反应」。

本任务让「点一行」把**该行所属项目 + 单元**一起变成当前，且只保留一条切换序列。

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 会话行点击 → `useActivateSession` 只调 `setActiveWorkspace(projectId, worktreePath)`，从不切项目 | `src/features/live-sessions/hooks/useActivateSession.ts:32` |
| 2 | 团队行三个动作走 `revealUnit`，同样只 `setActiveWorkspace` | `src/features/live-sessions/hooks/useTeamEntryActions.ts:76` |
| 3 | **切项目的唯一序列**是 `ProjectActionsContext.onSelectProject` → `useCrossTypeSelection.handleSelectProject`：关设置视图 → **清掉所有项目的激活单元** → 写 `activeProjectId/activeProject` → 按项目类型刷新 git → local 走 `useProjectSelection.selectProject`（内部再清回主仓单元 + 通知后端） | `src/features/project/hooks/useCrossTypeSelection.ts:41-76`、`src/features/project/hooks/useProjectSelection.ts:15-36` |
| 4 | `onSelectProject` 的类型是 `(projectId: ProjectId) => void`，但实现是 `async`（运行期返回 Promise） | `src/features/project/ProjectContext.tsx:7` |
| 5 | provider 挂在 app 根，覆盖整个 shell | `src/app/AppProviders.tsx:43` |
| 6 | 侧栏宿主各自已有一份「把单元亮出来」的闭包（`onRevealUnit`），但它们会**顺带开终端**，不是「只切当前」 | `UnitSessionList.tsx` 的 props 文档、`WorktreeRowList.tsx:145-150` |

第 3 条的第 5 步是关键：那是「切项目」的顺序决定，**不是**可选的清理。

## Requirements

- **R1** 点侧栏里属于某单元的行（会话行 / 团队行三种动作）⇒ 该行的**项目**与**单元**都成为当前。
- **R2** 切项目**只准**走 `ProjectActionsContext.onSelectProject`（唯一序列）。禁止在侧栏里
  重写 `setState(activeProjectId)` + 后端通知 + 按类型刷新 git 的组合。
- **R3** **已激活的项目不切**：那条序列会清掉所有项目的激活单元并回到主仓，对一个已经激活的
  项目重跑它是纯破坏（把用户刚点的工作树单元清回主仓）。
- **R4** 顺序：单元必须在切换序列**结算之后**落回。序列内部先清空各项目单元、再按类型落位，
  在它之前设单元等于自己把自己擦掉。因此 `onSelectProject` 的类型放宽为
  `(projectId: ProjectId) => void | Promise<void>`，调用侧 `Promise.resolve(...)` 后接续
  —— 不依赖「它今天恰好是同步的」。
- **R5** 缺少 provider 时**必须显式失败**（沿用 `useProjectActionsContext` 的 throwing 语义），
  不做静默降级：静默不切项目正是本任务要修的缺陷形态。
- **R6** 不改变任何「已经激活同一项目同一单元」的点击结果（幂等）。

## 明确不做

- 不改 `handleSelectProject` 的「清空各项目激活单元」语义（那是切项目类型需要的）。
- 不动 `onRevealUnit` 的「顺带开终端」语义（宿主用它表达「在这儿开终端」，与「切当前」是两件事）。
- 不做「记住每个项目上次的单元」这类状态。

## Acceptance Criteria

- [x] **AC1** 单测：`useActivateSession` 对**另一个项目**的会话 ⇒ 调 `onSelectProject(该项目)`，
      且 `setActiveWorkspace` 在切换结算之后调用（顺序断言），最终 `activeProjectId` 与单元都是该行所属。
- [x] **AC2** 单测：`useActivateSession` 对**当前项目**的会话 ⇒ **不调** `onSelectProject`（R3）。
- [x] **AC3** 单测：`useTeamEntryActions` 三个动作（接管队长 / 开面板 / 开看板）在跨项目时都先
      `onSelectProject`、后落单元；`instrumentation` 断言「先切项目、后落单元」的顺序。
- [x] **AC4** 单测：看板 tab 落在**团队自己的单元**的 tab 空间（跨项目 + 跨工作树两种情形）。
- [x] **AC5** 既有零回归：同一项目内的会话行 / 团队行点击结果与今天逐字一致（`onSelectProject` 零调用）。
- [x] **AC6** `pnpm check:quick` 通过；`pnpm exec vitest run src/features/live-sessions src/features/project src/features/connection src/features/agent-team src/features/editor` 全绿。

## Notes

- 红线自查：12（项目/单元身份只经 `WorkspaceSession.of` 与 `ProjectId` 品牌）、17（不新增
  「我点过哪个项目」的记账）。
- 相关（已归档）：`11-17-sidebar-lead-session` 记录了这条遗留；本任务收掉它并顺带修同一形态的
  会话行。

## 实施记录（与原计划的差异）

| # | 计划 | 实际 | 为什么 |
| --- | --- | --- | --- |
| 1 | context 从 `features/project/ProjectContext` 取 | **模块搬到 `shared/contexts/ProjectActionsContext.tsx`**，旧路径留 re-export 门面 | `live-sessions → features/project` 会成环：project 的侧栏渲染 `UnitSessionList`（`import/no-cycle` 实测命中 `components/ProjectGitSection`）。搬到零 feature 依赖的横切层解环，消费者零改动 |
| 2 | 全部消费者用 `useProjectActionsContext()` | `useTeamEntryActions` 用 context；**`useActivateSession` 收 `selectProject` 入参** | 它还有一个组合根调用点：`useDockBarOpenTab` 在 `App.tsx` 装配，而 `App.tsx` 在 provider **树外** —— 那里任何 `useContext` 首帧抛错（`state-management.md` 已记录过这个 P0 类）。两种形态都**必填**，无默认值 |
| 3 | 只在侧栏加「切项目」 | 顺带修好了**组合根**那条路径（dock bar 种类图标「接回上一次」） | `useActivateSession` 是共用实现，一处修好三处受益 |

顺序不变量已做**变异验证**：把「先落单元、后切项目」改回来 ⇒ 7 条用例变红；删掉「同项目不切」的守卫 ⇒ 3 条变红。
