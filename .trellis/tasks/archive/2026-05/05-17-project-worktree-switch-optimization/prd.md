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

---

### Slice 6: TerminalView 合并 3 次 fitAddon.fit() 为 1 次

**问题**：项目切换时 TerminalView 的两个 useEffect 加上 ResizeObserver 共触发 3 次 `fitAddon.fit()`，每次都做 DOM 测量 + cols/rows 计算 + `invoke("resize_terminal")` IPC。其中 Effect 1（font sync，L72-83）在 DOM 已被 Effect 2 cleanup detach 后执行，完全是空跑；ResizeObserver 在 re-attach 后立即触发，与 Effect 2 的 rAF fit 重复。

**目标**：每次切换只执行 1 次 fit + 1 次 resize IPC。

**方案**：
1. Effect 1（font sync）：移除 `fitAddon.fit()` 调用，只更新 `term.options.fontSize / fontFamily`。真正的 fit 由 Effect 2 的 rAF 负责。
2. Effect 2（主 effect）：在 rAF 中已有 fit，保留。
3. ResizeObserver：新建时用 flag 跳过首次触发（attach 导致的 resize 已由 rAF fit 处理），后续真实 resize 事件正常触发。

**涉及文件**：
- `src/components/terminal/TerminalView.tsx`: Effect 1 (L72-83)、Effect 2 ResizeObserver 初始化

**验收标准**：
- 项目切换时 `fitAddon.fit()` 只调用 1 次（可通过 console.debug 计数验证）
- `invoke("resize_terminal")` 只调用 1 次
- 终端渲染无视觉闪烁或尺寸错误

---

### Slice 7: clearWorktreeForProject 内联到 handleSelectProjectWithClear 的 big setState

**问题**：`handleSelectProjectWithClear` 中 `clearWorktreeForProject(projectId)` 是一次独立的 `appStore.setState`（写 worktreeStateMap），紧接着又有一次 big merge setState。虽然 React 18 会批处理，但 Zustand 内部仍执行两次完整的 state merge + notify 循环。

**目标**：将 clearWorktreeForProject 的逻辑内联到 big setState updater 中，减少为 1 次 store update。

**涉及文件**：
- `src/hooks/useAppContainer.ts`: `handleSelectProjectWithClear`
- `src/hooks/useWorktreeState.ts`: `clearWorktreeForProject` 仍保留导出（其他场景可能用），但 handleSelectProjectWithClear 不再调用它

**验收标准**：
- `handleSelectProjectWithClear` 内部只有 1 次 `appStore.setState`（不含 fire-and-forget IPC）
- clearWorktreeForProject 作为独立 API 仍可用

---

### Slice 8: check_agents_installed 加缓存，不随项目切换重跑

**问题**：`MainContent` L102-108 的 `useEffect` 在 `agents` 引用变化时触发 `check_agents_installed` IPC。后端对每个 agent 执行 `bash -i -c "echo $PATH"` + `which`（macOS 上单次 ~30-80ms）。项目切换虽然不直接改变 agents 列表，但 `agents` 来自 `useEditorContext()`，其 value 对象每次 render 都重新创建，导致 `agents` 引用可能变化从而意外触发。即使不误触发，首次加载时 N 个 agent 也需要 N 次 bash 进程，占 CPU 并阻塞后续 IPC。

**目标**：agent 安装状态只在 agent 列表真正变化时检查（通过 ID 列表比对），结果缓存到 store 或 module scope，避免重复检查。

**方案**：
1. 将 `check_agents_installed` 的结果缓存到 `useAppStore`（`agentInstalledMap: Record<string, boolean>`）或 module-level Map
2. `MainContent` 用 `useMemo(() => agents.map(a => a.id).join(','), [agents])` 做 ID 指纹，只有指纹变化时才触发 IPC
3. 或者：将检查移到 `useDelayedInit` / `useSessionBootstrap` 中只跑一次

**涉及文件**：
- `src/components/MainContent.tsx`: L100-108 useEffect
- 可选：`src/store/appStore.ts`（如果缓存到 store）

**验收标准**：
- 项目切换时不触发 `check_agents_installed` IPC
- Agent 列表首次加载时只调 1 次
- 新增 agent 后能正确刷新

---

### Slice 9: 首次终端创建显示骨架屏，PTY 创建不阻塞 UI

**问题**：首次打开项目终端时，`createTerminalForProject` 执行 xterm.js 实例化 + WebGL addon 动态 import + PTY 创建 IPC，总计 ~50-100ms。在此期间 UI 无反馈（wrapper div 空白）。

**目标**：切换到无终端缓存的项目时，立即显示骨架屏/loading 指示器，PTY 就绪后替换为真实终端。用户感知为即时切换。

**方案**：
1. TerminalView 在 cache miss 且 `createTerminalForProject` 未返回前，渲染一个轻量 loading 占位（背景色 + "Connecting..." 文字，与 xterm 背景一致）
2. `createTerminalForProject` 返回后切换为真实终端 DOM
3. 可选：将 `tryLoadWebgl()` 从创建路径移到 `requestIdleCallback`，减少关键路径耗时

**涉及文件**：
- `src/components/terminal/TerminalView.tsx`: 新增 loading state
- `src/components/terminal/terminalFactory.ts`: 可选 — WebGL 延迟加载

**验收标准**：
- 切换到无缓存项目时，200ms 内出现 loading 指示器（不是空白）
- PTY 就绪后 loading 指示器消失，终端正常显示
- 已有缓存的项目切换行为不变

## 执行顺序

### 第一批（已完成）：状态层优化

Slice 3 → 1 → 2 → 4 → 5：消除多轮渲染，已落地。

### 第二批：渲染层 + 资源层优化

Slice 7 最简单先做。Slice 6 收益最大。Slice 8 和 9 互相独立。

建议顺序：**7 → 6 → 8 → 9**

## 风险

### 第一批风险（已完成）
- Slice 1 和 Slice 2 涉及状态管理架构变更，需要确保 WSL/Remote 场景的切换行为不受影响
- `useSyncToStore` 被多个下游组件依赖，缩减字段时需要验证所有消费者
- 终端缓存（terminalCache）的 key 依赖 projectId + worktreePath 组合，状态迁移后 key 格式不能变

### 第二批风险
- Slice 6 改动 TerminalView 的 effect 结构，需要覆盖多种切换场景（project ↔ project、project ↔ worktree、首次 ↔ 已缓存）避免终端尺寸错误或白屏
- Slice 8 缓存 agent 安装状态后，用户在外部安装/卸载 agent 不会自动刷新，需要提供手动刷新入口或定时轮询
- Slice 9 的骨架屏需要与 xterm.js 终端背景色一致，否则切换时颜色闪烁反而更差
