# AppLayout Props 瘦身重构

## Goal

AppLayout 组件接收约 100 个 props，其中绝大多数只是从 App.tsx 透传到 ProjectsPanel 和 MainContent，组件本身几乎不消费。这导致：
- 接口臃肿，修改任何回调都需要穿越 3 层类型定义
- App.tsx 与子组件之间存在无意义的中间层
- 状态逻辑与布局渲染高度耦合

目标：通过引入领域 Context，消除 prop drilling，让 AppLayout 回归纯布局职责。

## What I already know

### 现状分析

| 组件 | Props 数量 | 实际消费 | 透传 |
|------|-----------|---------|------|
| AppLayout | ~100 | ~3 (activePanel, activeProjectId, onLoadFileTree) | ~97 |
| ProjectsPanel | ~40 | 部分消费，部分继续透传给 ProjectItem/WSLItem/RemoteItem |
| MainContent | ~55 | 部分消费，部分透传给 TerminalView/DiffView 等 |

### 已有 Context 模式

项目已有两个 Context 可作为参考：
- `AppContext` — 全局配置、agents、showToast（6 个字段）
- `SidebarContext` — 面板切换、宽度调整（4 个字段）

两者都采用 `createContext + Provider + useXxx hook` 的标准模式。

### Props 按领域分类

分析 AppLayout 的 ~100 个 props，可归为以下领域：

**1. 项目管理（Local Projects）~20 个**
- projects, activeProjectId, activeProject
- onAddProject, onRemoveProject, onSelectProject, onSelectFile, onRefreshGit
- onBackToMainTerminal, onOpenIde, onOpenWorktreeTerminal, onSelectWorktreeFile
- onDragEnd, onSaveProjectSettings
- handleSelectProject, handleAddProject

**2. WSL 项目（WSL Projects）~15 个**
- wslEntries, activeWslKey, wslOpenSessions, activeWslProject, activeWslWorktreePath
- onSelectWslProject, onCloseWslProject, onRemoveWslProject, onRemoveWslEntry, onAddWslProject
- onSelectWslFile, onRefreshWslGit, onOpenWslIde, onOpenWslWorktreeTerminal
- setWslOpenSessions

**3. SSH 远程项目（Remote Projects）~18 个**
- remoteEntries, activeRemoteKey, remoteOpenSessions, activeRemoteProject, activeRemoteWorktreePath
- remoteAuthStore
- onSelectRemoteProject, onCloseRemoteProject, onRemoveRemoteProject, onRemoveRemoteEntry, onAddRemoteProject
- onSelectRemoteFile, onRefreshRemoteGit, onOpenRemoteIde, onOpenRemoteWorktreeTerminal
- invokeRemoteGit, setRemoteOpenSessions

**4. Worktree & Diff 状态 ~8 个**
- activeWorktreePath, activeWorktreeBranch
- wslDiffState, remoteDiffState, worktreeDiffState
- onWslDiffBack, onRemoteDiffBack, onWorktreeDiffBack

**5. 终端 Tabs ~6 个**
- tabs, activeTabId, onActivateTab, onCloseTab, onAddTab, onTabStatusChange

**6. Agent 选择器 ~6 个**
- agents, compactMode, showAgentBar, hiddenAgentIds, onToggleHiddenAgent, onAgentClick

**7. 文件浏览 ~12 个**
- fileTree, fileTabs, activeFileTabId, fileViewLoading, activeFilePath
- onFileSelect, onFileRefresh, onFileCloseTab, onFileActivateTab, onFileSave, onFileContentChange, onLoadFileTree

**8. 杂项 ~3 个**
- suppressResizeRef, showToast（已在 AppContext 中）

## Research Notes

### React 最佳实践：解决 Prop Drilling

**方案 A: 领域 Context（推荐）**
- 按业务领域拆分 Context：ProjectContext, WslContext, RemoteContext 等
- Provider 放在 App.tsx 层，子组件通过 useXxxContext() 直接消费
- 优点：最小改动路径，与现有 AppContext/SidebarContext 模式一致
- 缺点：Context 变化会触发所有消费者重渲染（可通过拆分细粒度 Context 或 useMemo 缓解）

**方案 B: 组合模式（Compound Components / Render Props）**
- AppLayout 不接收数据 props，改用 children 或 slots 传入已绑定数据的子组件
- 优点：AppLayout 变为纯布局，零 props
- 缺点：App.tsx 的 JSX 会变得更复杂；子组件的组合关系从声明式变为命令式

**方案 C: 状态管理库（Zustand / Jotai）**
- 将领域状态提升到外部 store
- 优点：细粒度订阅，性能最优
- 缺点：引入新依赖，与现有 hooks 体系改动较大，迁移成本高

### 本项目约束

- 已有 Context 模式，团队熟悉
- hooks 层已按领域划分（useLocalProjects, useWslProjects, useRemoteProjects）
- 不希望引入新依赖（CLAUDE.md: 不自作主张加功能）
- 渐进式改动优先（CLAUDE.md: 最小改动原则）

## Decisions

### Context 粒度 — 3 个中粒度 Context (方案 B)

同一分组内的数据天然一起变化，拆太细增加维护成本。3 层 Provider 嵌套清晰可控。

| Context | 包含领域 | 字段来源 |
|---------|---------|---------|
| `ProjectContext` | local projects + worktree + diff 状态 | useLocalProjects, useWorktreeState, worktreeDiffState, callbacks(project相关) |
| `ConnectionContext` | WSL + SSH remote | useWslProjects, useWslActions, useRemoteProjects, useRemoteActions |
| `EditorContext` | terminal tabs + agent 选择器 + file view | useTerminalTabs, agent 相关 config, useFileView |

### 实施策略 — 一次性重构 (方案 A)

一个 PR 完成所有 Context 引入和 props 移除。

## Requirements (evolving)

- [ ] 消除 AppLayout 的 prop drilling，props 数量降至 10 个以内
- [ ] 引入领域 Context，与现有 AppContext/SidebarContext 模式一致
- [ ] AppLayout 回归纯布局职责（面板切换 + 区域排列）
- [ ] 不引入新的外部依赖
- [ ] 不改变现有功能行为，纯重构

## Acceptance Criteria

- [ ] AppLayoutProps 接口 props 数量 <= 10
- [ ] ProjectsPanel 和 MainContent 通过 Context hook 获取数据，不再从 AppLayout 接收透传 props
- [ ] `npx tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] 手动验证：本地项目、WSL 项目、SSH 项目的核心操作（选择、终端、diff、worktree）正常

## Definition of Done

- 类型检查通过
- 现有测试通过
- 功能回归测试通过（手动）
- 无新增外部依赖

## Out of Scope

- 不重构 App.tsx 的 hooks 调用方式（保持 useLocalProjects 等现有结构）
- 不重构子组件内部逻辑（ProjectItem, RemoteItems 等）
- 不引入状态管理库
- 不做性能优化（如 memo 策略调整），除非重构过程中自然产生
- 不改动 TitleBar、SettingsPanel、对话框等不经过 AppLayout 的组件

## Technical Notes

### 关键文件

| 文件 | 角色 |
|------|------|
| `src/App.tsx` | 状态源头，Provider 注入点 |
| `src/components/layout/AppLayout.tsx` | 重构主体，消除 props |
| `src/components/panels/ProjectsPanel.tsx` | 消费者，改为 Context |
| `src/components/MainContent.tsx` | 消费者，改为 Context |
| `src/context/app-context.tsx` | 现有模式参考 |
| `src/context/sidebar-context.tsx` | 现有模式参考 |

### 改动模式（以 ProjectContext 为例）

```
// 1. 新建 src/context/project-context.tsx
// 2. App.tsx 中 <ProjectProvider value={...}> 包裹 AppLayout
// 3. ProjectsPanel 中 useProjectContext() 替代 props
// 4. AppLayout 中删除对应 props 定义和透传
```
