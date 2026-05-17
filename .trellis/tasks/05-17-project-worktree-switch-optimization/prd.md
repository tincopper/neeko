# Project / Worktree 切换性能优化

## 问题描述

Project 之间和 Worktree 之间的切换不够丝滑。根因是切换链路中存在多轮冗余渲染：

1. `handleSelectProjectWithClear` 触发 5+ 次独立 setState（混合 Zustand + React useState），每次都触发一轮 reconciliation
2. `useWorktreeState` 使用 local useState，需经 `useSyncToStore` 的 useEffect 桥接到 appStore，导致 double-render
3. `handleOpenWorktreeTerminal` 中跨 project 切换时 await 后端 IPC（实际只是 Mutex set，不需要等）
4. tabKey 变更后通过 useEffect 恢复 activeTabId，额外触发一轮渲染

## 目标

将 project/worktree 切换从多轮渲染（3-5 轮）降到单轮渲染，消除用户可感知的卡顿。

## Slice 清单

### Slice 1: 合并 handleSelectProjectWithClear 的多次 setState

**问题**：`handleSelectProjectWithClear` 依次调用 `closeAppSettingsTab`、`clearWorktreeForProject`、`setState(清 WSL/Remote)`、`clearWslTransientState`（4x useState）、`clearRemoteTransientState`（4x useState）、`handleSelectProject`（Zustand setState）。混合 Zustand + useState 导致批处理边界不一致，触发多轮渲染。

**目标**：将所有 clearing 操作合并为一次 `appStore.setState` 调用。前提是将 WSL/Remote transient state（diffState、worktreePath、worktreeBranch、openedWt）收入 Zustand。

**涉及文件**：
- `src/hooks/useAppContainer.ts`: `handleSelectProjectWithClear`、`clearWslTransientState`、`clearRemoteTransientState`
- `src/hooks/useConnectionWorktreeState.ts`: 4 个 useState → appStore 或合并为单一对象
- `src/hooks/useWslActions.ts`: 引用 worktreeState
- `src/hooks/useRemoteActions.ts`: 引用 worktreeState
- `src/hooks/useSyncToStore.ts`: 去掉已收入 appStore 的字段
- `src/store/appStore.ts`: 新增 transient state 字段

**验收标准**：
- `handleSelectProjectWithClear` 内部只触发一次 `appStore.setState`（不含 fire-and-forget IPC）
- React DevTools Profiler 中 project 切换只出现 1 轮 commit（不含 file tree 加载）

---

### Slice 2: worktreeState 从 useState 搬入 appStore

**问题**：`useWorktreeState` 用 `useState<WorktreeStateMap>` 管理 per-project worktree 状态，然后 `useSyncToStore` 通过 useEffect 把 `activeWorktreePath`、`activeWorktreeBranch`、`openedWorktrees` 桥接到 appStore。切换 worktree 时先触发 useState 渲染，再触发 appStore 渲染，downstream 组件（DockPanelWrappers、TerminalView、TitleBar）只在第二轮才拿到新值。

**目标**：将 `worktreeStateMap` 直接放入 appStore，`setActiveWorktreePath` 等 setter 直接写 appStore。去掉 `useSyncToStore` 中对应字段的桥接。

**涉及文件**：
- `src/hooks/useWorktreeState.ts`: 重构为读写 appStore
- `src/hooks/useSyncToStore.ts`: 移除 worktree 相关字段
- `src/store/appStore.ts`: 新增 `worktreeStateMap` 及 derived selectors
- `src/hooks/useAppContainer.ts`: 适配新接口

**验收标准**：
- `useSyncToStore` 不再同步 `activeWorktreePath`、`activeWorktreeBranch`、`openedWorktrees`
- Worktree 切换在 React DevTools Profiler 中只出现 1 轮 commit

---

### Slice 3: handleOpenWorktreeTerminal 中 set_active_project 改 fire-and-forget

**问题**：`useWorktreeActions.handleOpenWorktreeTerminal` 在跨 project 切换时 `await invoke("set_active_project", ...)`，但后端只是 `*guard = Some(projectId)`，一个 Mutex set，不需要等待。这个 await 阻塞了后续的 `setActiveWorktreePath` 等操作。

**目标**：改为 fire-and-forget，与 `handleSelectProject` 保持一致。

**涉及文件**：
- `src/hooks/useWorktreeActions.ts`: `handleOpenWorktreeTerminal` L57

**验收标准**：
- `invoke("set_active_project")` 不再 await
- 从 project A 的 worktree 切到 project B 的 worktree 时无感知延迟

---

### Slice 4: tabKey 变更时在同一 setState 中更新 activeTabId

**问题**：`useAppContainer` L341-345 用 useEffect 监听 tabKey 变化来恢复 activeTabId。tabKey 由 `activeWorktreePath + currentProjectId` 计算，worktree 切换时第一轮渲染 tabKey 变了但 activeTabId 还是旧的，useEffect 触发后才更新 — 多一轮渲染。

**目标**：在 `setActiveWorktreePath` / `setActiveProjectId` 的同一个 `appStore.setState` 调用中，一并计算并更新 `activeTabId`。

**涉及文件**：
- `src/hooks/useAppContainer.ts`: L341-345 useEffect
- `src/store/appStore.ts` 或 `src/hooks/useWorktreeState.ts`: setState 时一并更新 activeTabId
- `src/hooks/useLocalProjects.ts`: `setActiveProjectId` 已包含 activeTabId 恢复（参考模式）

**验收标准**：
- 删除 useAppContainer L341-345 的 tabKey useEffect
- Worktree 切换后 activeTabId 在同一轮渲染中就是正确值

---

### Slice 5: clearWslTransientState / clearRemoteTransientState 使用 resetConnectionState

**问题**：`clearWslTransientState` 和 `clearRemoteTransientState` 各调 4 个独立 useState setter。`useConnectionWorktreeState` 已提供 `resetConnectionState()` 方法（一次 setState 清零），但没被使用。

**目标**：如果 Slice 1 已将 transient state 收入 appStore，此 slice 自动解决。否则使用 `resetConnectionState()` 替代 4 个独立 setter。

**前置依赖**：Slice 1（如果 Slice 1 已合并到 appStore，本 slice 可跳过）

**涉及文件**：
- `src/hooks/useAppContainer.ts`: `clearWslTransientState`、`clearRemoteTransientState`

**验收标准**：
- 每个 clear 函数内部只调一次 state 更新（不管是 appStore.setState 还是 resetConnectionState）

## 执行顺序

Slice 3 最独立，可最先做。Slice 1 和 Slice 2 是核心重构，互相有接触面但可以分开。Slice 4 依赖 Slice 2 的成果。Slice 5 视 Slice 1 结果决定是否需要。

建议顺序：**3 → 1 → 2 → 4 → 5**

## 风险

- Slice 1 和 Slice 2 涉及状态管理架构变更，需要确保 WSL/Remote 场景的切换行为不受影响
- `useSyncToStore` 被多个下游组件依赖，缩减字段时需要验证所有消费者
- 终端缓存（terminalCache）的 key 依赖 projectId + worktreePath 组合，状态迁移后 key 格式不能变
