# Design — 侧栏点击 = 切项目 + 切单元

## 1. 一条判据，两个消费者

缺陷不是一个函数写错了，而是一条**规则没有名字**：「点侧栏里属于某个单元的东西，那个单元
（连同它的项目）就是我正在看的东西」。现在两个地方各写了一半（只切单元），所以规则要抽出来。

```
activateUnit(projectId, worktreePath)        ← 唯一落点（新，live-sessions/utils）
  ├─ 项目不同 ⇒ await onSelectProject(projectId)   ← 唯一序列（R2）
  └─ 单元总是落回 setActiveWorkspace(projectId, worktreePath)
```

消费者：`useActivateSession`（会话行）、`useTeamEntryActions`（团队行三个动作）。

为什么不放进 `workspaceStore`：它是 store，不认识「激活项目」这件事是**组合根**的编排
（关设置视图、按环境刷新 git、通知后端），那条序列在 `useCrossTypeSelection`。store 去认识它
就是反向依赖。

## 2. 顺序与「已激活就不切」

`handleSelectProject` 依次做：

1. `closeSettingsView()`
2. **清掉所有项目的激活单元**（`clearActiveWorkspace(pid)` for each）
3. 写 `activeProjectId / activeProject`
4. WSL / Remote ⇒ 刷新 git；local ⇒ `selectProject(projectId)`，它**再清一次目标项目的单元**
   （回主仓）并通知后端

所以：

| 情形 | 动作 |
| --- | --- |
| 项目不同 | `onSelectProject(pid)` —— **等它结算** —— 再 `setActiveWorkspace(pid, wt)` |
| 项目相同 | 直接 `setActiveWorkspace(pid, wt)` |

**为什么必须等**：`handleSelectProject` 是 `async`，类型上却返回 `void`（`ProjectContext.tsx:7`）。
今天它的第一个 `await` 在 `selectProject(projectId)`，而 `selectProject` 体内没有 await ⇒ 整段
同步跑完，先 select 后 set 恰好正确。但这是**巧合**：任何一天有人在那两步之间插一个真正的
`await`（比如 `await refreshGit(...)`），单元就会被清回主仓，而症状只是「点了没落到那个工作树」，
没人会想到是这里。

因此把类型放宽成 `void | Promise<void>`（实现本来就是 async，这是把运行期事实写进类型），
调用侧 `Promise.resolve(onSelectProject(pid)).then(() => setUnit())` —— 无论内部有几个 await，
单元都是**最后**落的。

## 3. 已激活就不切（R3）不是优化，是正确性

对已激活项目重跑那条序列的后果：

- 清空该项目单元 → 用户刚点的工作树单元消失；
- local 分支 `selectProject` 再清一次并回到主仓；
- 额外一次 `setActiveProject` IPC。

所以判据是 `useProjectStore.getState().activeProjectId !== projectId` **才**切。

## 4. 能力来源：context（单点）而不是逐宿主注入

`useProjectActionsContext()`：

- provider 在 `AppProviders` 最外层，覆盖整个 shell（`src/app/AppProviders.tsx:43`）；
- 是 `features/project` 门面的公开导出，`live-sessions → project 门面` 属允许方向；
- 逐宿主注入要动 4 个宿主 + `ProjectsPanel` 的透传，而其中两个（`WorktreeList` /
  `ConnectionWorktreeList`）**今天根本没有** `onSelectProject` —— 为了一个能力把它们各加一个 prop
  是更大的面。

**不做可选读法**（`useOptionalProjectActionsContext`）：静默不切项目就是本缺陷本身。缺 provider
应当渲染失败（测试也一样），而不是安静地少做一件事。

副作用：`UnitSessionList.test.tsx` / `ProjectsPanel.test.tsx` 这类直接渲染侧栏子树的用例需要包一层
provider（测试侧一个 helper 即可）。这是诚实的代价 —— 这个子树确实需要那个能力。

## 5. 回归面

| 调用点 | 变化 |
| --- | --- |
| `useActivateSession`（会话行） | 项目相同 ⇒ 零变化；项目不同 ⇒ 现在会切项目（修好的那一半）|
| `useTeamEntryActions.onOpenLead` | 同上；`openExistingTerminalTab` 仍按**团队自己的** projectId 落键 |
| `useTeamEntryActions.onOpenTeamPanel` | 同上；`openTeam` + `activateView(panelView('team'))` 不变 |
| `useTeamEntryActions.onOpenBoard` | 同上；看板 tab 的 key 由 `activeWorkspaceSession(projectId)` 铸，单元必须先落 |
| `UnitTeamEntries`（纯展示） | 零变化 |

## 6. 测试策略

`activateUnit` 是纯编排（三个 store + 一个注入的切换函数），可在 `renderHook` 里用 provider
注入 spy，断言**调用顺序**（`order: ['select:B', 'unit:p1/B/wt']`），这是本设计唯一承重的不变量。

断「顺序」而不是断「最终状态」：最终状态在同步实现下两种顺序都能对，只有顺序断言能钉住
「将来插一个 await 也不会退化」。
