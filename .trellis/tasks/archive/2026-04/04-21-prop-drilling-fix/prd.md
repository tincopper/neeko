# 消除 Prop 穿透

## Goal

消除 MainContent 及其子组件之间的 prop 穿透问题，让子组件直接从 Context 消费数据，降低组件间耦合度，提升可维护性。

## What I already know

### 现状分析

项目已有 8 个 Context（project-state, project-actions, editor, wsl, remote, app, sidebar, skill），App.tsx 和 MainContent 本身已经通过 Context 获取数据，**不再接收 props**。

**但 MainContent 仍然在向子组件穿透 props：**

| 子组件 | 穿透 props 数 | 数据来源 |
|--------|--------------|----------|
| RemoteProjectView | 8 | remoteContext + appContext |
| FileViewer | 8 | projectStateContext + projectActionsContext + appContext |
| TerminalView | 10 | projectStateContext + editorContext + appContext + 局部计算 |
| WorktreeTerminalView | 8 | projectStateContext + appContext |
| WSLTerminalView | 10 | wslContext + appContext + 局部回调 |
| DiffView (x3) | 4 each | 各域 diffState + config.diffMode + 局部回调 |

### Props 精确分类（穿透 vs 合理 props）

经逐行分析，props 分为三类：

**A. 纯穿透（从 Context 取出原样传递）— 应消除**
- `config.terminalFontSize` / `config.fontFamily` / `config.shell` / `config.diffMode` / `config.theme` / `config.editorFontSize` → 子组件可直接用 `useAppContext()`
- `remoteAuthStore` / `remoteDiffState` / `onRemoteDiffBack` / `activeRemoteWorktreePath` → 子组件可直接用 `useRemoteContext()`
- `fileTabs` / `activeFileTabId` → 子组件可直接用 `useProjectStateContext()`
- `onFileSave` / `onFileCloseTab` / `onFileActivateTab` / `onFileContentChange` → 子组件可直接用 `useProjectActionsContext()`
- `activeProject` / `activeWorktreePath` / `activeWorktreeBranch` → 子组件可直接用 `useProjectStateContext()`
- `suppressResizeRef` → 子组件可直接用 `useProjectActionsContext()`
- `activeWslProject` / `activeWslWorktreePath` / `wslDiffState` / `onWslDiffBack` → 子组件可直接用 `useWslContext()`

**B. 来自 SplitLayout renderPane 的参数 — 必须保留**
- `paneId`：SplitLayout 通过 render prop 传入，子组件无法从 Context 获取

**C. MainContent 局部计算/回调 — 需逐个决策**

| 局部值 | 当前定义位置 | 决策 |
|--------|-------------|------|
| `onRemoteSessionReady(pid)` | MainContent L140-144 | 逻辑仅 `setRemoteOpenSessions(prev => new Set(prev).add(pid))`，移入 RemoteProjectView |
| `onWslSessionReady(pid)` | MainContent L133-137 | 逻辑仅 `setWslOpenSessions(prev => new Set(prev).add(pid))`，移入 WSLTerminalView 调用处 |
| `handleTerminalTabStatusChange(status)` | MainContent L124-130 | 包装 `onTabStatusChange(activeTabId, status)`，移入 TerminalView |
| `tabAgentId` | MainContent L87 | `activeTab?.agentId ?? null`，移入 TerminalView 内部计算 |
| `agentCommandOverride` | MainContent L337-340 | `config.agentCommandOverrides?.[activeTabAgentId ?? activeProject.selected_agent ?? ""]`，移入 TerminalView 内部计算 |
| `activeTab` | MainContent L86 | `tabs.find(tab => tab.id === activeTabId)`，移入 TerminalView |

### DiffView 特殊分析

DiffView 在 MainContent 中被调用 3 次，每次传入不同的 `diffSource`：

1. **WSL Diff** (L251-256)：`diffSource = { type: "wsl", distro, projectPath }`，数据来自 `wslDiffState`
2. **Worktree Diff** (L311-318)：`diffSource = { type: "worktree", projectId, worktreePath }`，数据来自 `worktreeDiffState`
3. **Local Diff** (L361-366)：`diffSource = { projectId }`，数据来自 `activeProject.active_view`

**结论**：DiffView 的 props 不是穿透。每次调用传入不同的 `diffSource` 对象，这是合理的参数化渲染。`initialMode={config.diffMode}` 是唯一可消除的穿透项，但为此让 DiffView 依赖 appContext 收益太小。**DiffView 不改动。**

---

## Requirements

### R1: RemoteProjectView — 消除全部 8 个 props

**当前 props (8个)**：
```
entry, project, remoteAuthStore, remoteDiffState, config,
onRemoteDiffBack, activeRemoteWorktreePath, onRemoteSessionReady
```

**改动步骤**：

1. RemoteProjectView 内部添加 `useRemoteContext()` 获取：
   - `activeRemoteProject` → 解构出 `entry` 和 `project`
   - `remoteAuthStore`
   - `remoteDiffState`
   - `onRemoteDiffBack`
   - `activeRemoteWorktreePath`
   - `setRemoteOpenSessions`
2. RemoteProjectView 内部添加 `useAppContext()` 获取：
   - `config`（用 `config.diffMode`、`config.terminalFontSize`、`config.fontFamily`）
3. 将 `onRemoteSessionReady` 逻辑内联到 RemoteProjectView 内部：
   ```ts
   const onRemoteSessionReady = useCallback((pid: string) => {
     setRemoteOpenSessions(prev => new Set(prev).add(pid));
   }, [setRemoteOpenSessions]);
   ```
4. 删除 `RemoteProjectViewProps` 接口，组件变为无 props
5. MainContent 中调用改为 `<RemoteProjectView />`
6. MainContent 中删除对 `remoteAuthStore`、`remoteDiffState`、`onRemoteDiffBack`、`activeRemoteWorktreePath`、`setRemoteOpenSessions` 的解构（如果其他地方不再使用）

**影响文件**：
- `src/components/RemoteProjectView.tsx`（主改）
- `src/components/MainContent.tsx`（删除 props 传递 + 清理 Context 解构）

---

### R2: FileViewer — 消除全部 8 个 props

**当前 props (8个)**：
```
tabs, activeTabId, theme, fontFamily, editorFontSize,
onSave, onCloseTab, onActivateTab, onContentChange
```

**改动步骤**：

1. FileViewer 内部添加 `useProjectStateContext()` 获取：
   - `fileTabs`（映射为内部 `tabs`）
   - `activeFileTabId`（映射为内部 `activeTabId`）
2. FileViewer 内部添加 `useProjectActionsContext()` 获取：
   - `onFileSave`（映射为内部 `onSave`）
   - `onFileCloseTab`（映射为内部 `onCloseTab`）
   - `onFileActivateTab`（映射为内部 `onActivateTab`）
   - `onFileContentChange`（映射为内部 `onContentChange`）
3. FileViewer 内部添加 `useAppContext()` 获取：
   - `config.theme`
   - `config.fontFamily`
   - `config.editorFontSize`
4. 删除 `FileViewerProps` 接口，组件变为无 props
5. MainContent 中调用改为 `<FileViewer />`
6. MainContent 中删除对 `fileTabs`、`activeFileTabId`、`onFileSave`、`onFileCloseTab`、`onFileActivateTab`、`onFileContentChange` 的解构（如果其他地方不再使用）

**注意**：FileViewer 内部变量名（`tabs`、`onSave` 等）与 Context 导出名（`fileTabs`、`onFileSave` 等）不同，需在解构时重命名：
```ts
const { fileTabs: tabs, activeFileTabId: activeTabId } = useProjectStateContext();
```

**影响文件**：
- `src/components/panels/FileViewer.tsx`（主改）
- `src/components/MainContent.tsx`（删除 props 传递 + 清理）

---

### R3: TerminalView — 消除可消除的 props，保留 render prop 参数

**当前 props (10个)**：
```
project, paneId, tabId, tabAgentId, fontSize, shell,
fontFamily, suppressResizeRef, agentCommandOverride, onTabStatusChange
```

**分类**：
- **可消除（6个）**：`project`, `fontSize`, `shell`, `fontFamily`, `suppressResizeRef`, `onTabStatusChange`
- **需保留（1个）**：`paneId`（来自 SplitLayout renderPane）
- **移入内部计算（3个）**：`tabId`, `tabAgentId`, `agentCommandOverride`

**改动步骤**：

1. TerminalView 内部添加 `useProjectStateContext()` 获取：
   - `activeProject`（替代 `project` prop）
2. TerminalView 内部添加 `useAppContext()` 获取：
   - `config`（替代 `fontSize`、`shell`、`fontFamily` 三个 props）
3. TerminalView 内部添加 `useProjectActionsContext()` 获取：
   - `suppressResizeRef`
4. TerminalView 内部添加 `useEditorContext()` 获取：
   - `tabs`、`activeTabId`、`onTabStatusChange`
5. 内部计算以下值（从 MainContent 移入）：
   ```ts
   const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
   const tabAgentId = activeTab?.agentId ?? null;
   const agentCommandOverride = config.agentCommandOverrides?.[
     tabAgentId ?? activeProject?.selected_agent ?? ""
   ];
   ```
6. `handleTerminalTabStatusChange` 包装逻辑移入 TerminalView 内部
7. Props 接口缩减为仅 `{ paneId: string }`
8. MainContent 中 SplitLayout renderPane 简化为：
   ```tsx
   renderPane={(paneId) => <TerminalView paneId={paneId} />}
   ```

**影响文件**：
- `src/components/terminal/TerminalView.tsx`（主改）
- `src/components/MainContent.tsx`（简化 renderPane + 清理）

**风险**：TerminalView 当前是一个复杂组件（295行），需要检查 `terminalTypes.ts` 中 `TerminalViewProps` 的定义是否被其他地方引用，以及 re-export 链是否受影响。

---

### R4: WorktreeTerminalView — 消除全部 8 个 props

**当前 props (8个)**：
```
projectId, projectName, worktreePath, worktreeBranch,
selectedAgent, fontSize, shell, fontFamily
```

**改动步骤**：

1. WorktreeTerminalView 内部添加 `useProjectStateContext()` 获取：
   - `activeProject` → 解构出 `projectId = activeProject.id`, `projectName = activeProject.name`, `selectedAgent = activeProject.selected_agent`
   - `activeWorktreePath`（替代 `worktreePath` prop）
   - `activeWorktreeBranch`（替代 `worktreeBranch` prop）
2. WorktreeTerminalView 内部添加 `useAppContext()` 获取：
   - `config`（替代 `fontSize`、`shell`、`fontFamily` 三个 props）
3. 删除 `WorktreeTerminalViewProps` 接口，组件变为无 props
4. MainContent 中调用改为 `<WorktreeTerminalView />`

**影响文件**：
- `src/components/terminal/WorktreeTerminalView.tsx`（主改）
- `src/components/MainContent.tsx`（简化调用）

---

### R5: WSLTerminalView 调用处 — 消除可消除的 props

**当前在 MainContent 中传递的 props (10个)**：
```
paneId, distro, projectId, projectName, projectPath,
fontSize, fontFamily, cacheKeySuffix, selectedAgentId, onSessionReady
```

**分类**：
- **可消除（8个）**：`distro`, `projectId`, `projectName`, `projectPath`, `fontSize`, `fontFamily`, `cacheKeySuffix`, `selectedAgentId` — 全部来自 `wslContext` + `appContext`
- **需保留（1个）**：`paneId`（来自 SplitLayout renderPane）
- **移入内部（1个）**：`onSessionReady`（即 `onWslSessionReady`，逻辑为 `setWslOpenSessions(prev => new Set(prev).add(pid))`）

**改动步骤**：

1. WSLTerminalView 内部添加 `useWslContext()` 获取：
   - `activeWslProject` → 解构出 `distro`、`project.id`、`project.name`、`project.path`、`project.selected_agent`
   - `activeWslWorktreePath`（用于计算 `projectPath` 和 `cacheKeySuffix`）
   - `setWslOpenSessions`
2. WSLTerminalView 内部添加 `useAppContext()` 获取：
   - `config`（替代 `fontSize`、`fontFamily`）
3. 内部计算：
   ```ts
   const projectPath = activeWslWorktreePath ?? activeWslProject.project.path;
   const cacheKeySuffix = activeWslWorktreePath
     ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, "")}`
     : "";
   ```
4. `onWslSessionReady` 内联到 WSLTerminalView 内部
5. Props 接口缩减为仅 `{ paneId: string }`
6. MainContent 中 SplitLayout renderPane 简化为：
   ```tsx
   renderPane={(paneId) => <WSLTerminalView paneId={paneId} />}
   ```

**影响文件**：
- `src/components/terminal/WSLTerminalView.tsx`（主改）
- `src/components/MainContent.tsx`（简化 renderPane + 清理）

---

### R6: MainContent 最终清理

完成 R1-R5 后，MainContent 应：

**仍保留的 Context 消费**（MainContent 自身逻辑需要）：
- `useAppContext()` → `config`（用于 Agent Bar 逻辑）、`showToast`（用于 handleAgentClick）
- `useProjectStateContext()` → `activeProject`（条件渲染判断）、`worktreeDiffState`（条件渲染）、`fileTabs`（判断 showFileViewer）、`activeWorktreePath`（条件渲染）
- `useProjectActionsContext()` → `handleSelectProject`（Diff onBack 回调）、`handleAddProject`（空状态按钮）
- `useWslContext()` → `activeWslProject`（条件渲染）、`wslDiffState`（条件渲染）、`onWslDiffBack`（DiffView onBack）
- `useRemoteContext()` → `activeRemoteProject`（条件渲染）
- `useEditorContext()` → `tabs`, `activeTabId`, `onActivateTab`, `onCloseTab`, `onAddTab`（TerminalTabBar）+ Agent Bar 相关全部

**可删除的 Context 解构项**：
- 从 `useProjectStateContext()`：`activeWorktreeBranch`、`activeFileTabId`
- 从 `useProjectActionsContext()`：`suppressResizeRef`、`onFileCloseTab`、`onFileActivateTab`、`onFileSave`、`onFileContentChange`、`onWorktreeDiffBack`
- 从 `useRemoteContext()`：`remoteAuthStore`、`remoteDiffState`、`onRemoteDiffBack`、`activeRemoteWorktreePath`、`setRemoteOpenSessions`
- 从 `useWslContext()`：`activeWslWorktreePath`、`setWslOpenSessions`

**可删除的局部函数**：
- `onWslSessionReady`（移入 WSLTerminalView）
- `onRemoteSessionReady`（移入 RemoteProjectView）
- `handleTerminalTabStatusChange`（移入 TerminalView）

**DiffView 调用不变** — 保持 props 传递，这是合理的参数化渲染。

---

## 不改动的组件（附理由）

| 组件 | 理由 |
|------|------|
| DiffView | 3 次调用传入不同 diffSource，是合理参数化，非穿透 |
| TerminalTabBar | 接收 tabs/activeTabId/callbacks，MainContent 自身 Agent Bar 逻辑需要这些值，不算穿透 |
| RemoteDialog | 经调研无穿透，所有 props 自用 |

---

## Acceptance Criteria

- [ ] RemoteProjectView 变为无 props 组件，内部消费 useRemoteContext + useAppContext
- [ ] FileViewer 变为无 props 组件，内部消费 useProjectStateContext + useProjectActionsContext + useAppContext
- [ ] TerminalView props 缩减为仅 `{ paneId: string }`
- [ ] WorktreeTerminalView 变为无 props 组件
- [ ] WSLTerminalView props 缩减为仅 `{ paneId: string }`
- [ ] MainContent 删除 6+ 个局部回调/变量（onWslSessionReady, onRemoteSessionReady, handleTerminalTabStatusChange, tabAgentId, agentCommandOverride, activeTab 中与 TerminalView 相关的）
- [ ] MainContent Context 解构项减少 15+ 个
- [ ] `pnpm test` 全部通过
- [ ] `npx tsc --noEmit` 无类型错误
- [ ] UI 功能不变：终端、Diff、文件查看、远程连接均正常

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- 功能回归验证：本地项目、WSL、SSH 远程三种模式

## Out of Scope

- 不拆分或新建 Context（现有 8 个 Context 粒度已足够）
- 不重构 Context 的 value 结构
- 不改动 DiffView 的 props 模式
- 不处理 TODO.md 中的 "Hook 复杂度过高" 和 "Context 膨胀" 问题
- 不动 RemoteDialog（无穿透）
- 不改动 TerminalTabBar（MainContent 自身需要那些值）

## Implementation Order

按风险从低到高排序：

| 步骤 | 组件 | 复杂度 | 消除 props 数 | 说明 |
|------|------|--------|--------------|------|
| 1 | WorktreeTerminalView | 低 | 8 → 0 | 最简单，无 render prop，无局部回调迁移 |
| 2 | RemoteProjectView | 低 | 8 → 0 | 需迁移 onRemoteSessionReady（一行逻辑） |
| 3 | FileViewer | 低 | 8 → 0 | 需注意变量重命名（fileTabs→tabs） |
| 4 | WSLTerminalView | 中 | 10 → 1 | 保留 paneId，需迁移 onWslSessionReady + 计算 cacheKeySuffix |
| 5 | TerminalView | 中 | 10 → 1 | 保留 paneId，需迁移 3 个局部计算 + handleTerminalTabStatusChange |
| 6 | MainContent 清理 | 低 | — | 删除不再需要的 Context 解构和局部函数 |

每完成一步后运行 `npx tsc --noEmit` 确认类型正确。

## Technical Notes

### 文件清单

- `src/components/MainContent.tsx` (388行) — 主清理目标
- `src/components/RemoteProjectView.tsx` (88行) — R1
- `src/components/panels/FileViewer.tsx` — R2
- `src/components/terminal/TerminalView.tsx` (295行) — R3
- `src/components/terminal/WorktreeTerminalView.tsx` — R4
- `src/components/terminal/WSLTerminalView.tsx` — R5
- `src/components/terminal/terminalTypes.ts` — 可能需更新 TerminalViewProps 类型

### 现有 Context 层级

```
App.tsx
  └─ AppProviders (appContext, sidebar, skill)
       └─ ProjectStateProvider
            └─ ProjectActionsProvider
                 └─ EditorProvider
                      └─ WslProvider
                           └─ RemoteProvider
                                └─ AppLayout
                                     └─ MainContent
                                          └─ 子组件们（都在所有 Provider 内部）
```

所有子组件都在 Provider 范围内，可以安全地直接消费 Context。

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| TerminalViewProps 类型被 re-export 到外部 | 检查 `terminalTypes.ts` 和 TerminalView 的 export 链 |
| WorktreeTerminalView 依赖 `activeProject` 非空 | 该组件只在 `activeProject` 存在时渲染，运行时安全 |
| FileViewer 变量名与 Context 导出名不一致 | 解构时用 alias：`{ fileTabs: tabs }` |
| Agent Bar 逻辑仍在 MainContent 中 | 不在本次范围内，但 Agent Bar 可能是下一步提取为独立组件的目标 |
