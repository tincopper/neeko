# Refactor App.tsx

## Goal

将 App.tsx 从 575 行缩减到 ~250-300 行，通过提取 4 个专注的 hook 来消除散落的逻辑，同时保持项目现有的 Props 下传架构不变。

## What I already know

* App.tsx 是"中央状态协调器"——这是 `state-management.md` 中定义的设计意图
* 项目明确避免 Context API 和外部状态管理库
* Props 下传到 ProjectSidebar（40+ props）和 MainContent（30+ props）是预期模式
* 除 App.tsx 外所有组件使用 `React.memo`
* Ref 镜像模式广泛使用且是有意为之
* `useUnifiedProjects` hook 存在（306 行）但未在 App.tsx 中使用

### 识别的痛点

1. **保存逻辑分散** — 3 个独立的 save 函数（`saveSession`、`saveWorktreeState`、`saveSessionPartial`）
2. **大规模 ref 同步 effect** — 25 行同步 14+ 个 ref
3. **~100 行内联回调** — IDE、agent、worktree、auth、UI 回调全在 App.tsx
4. **重复的 side terminal 模式** — 本地/WSL/远程各有几乎相同的开关逻辑
5. **跨域 ref 手动接线** — hook 返回后 8 行手动设置 `.current`

## Requirements

* 从 App.tsx 提取 4 个专注的 hook
* 保持 Props 下传架构不变
* 不引入新的依赖
* 纯结构性重构，不改变任何行为

### 提取的 Hook

| 新 Hook | 提取内容 | 节省行数 |
|---------|----------|----------|
| `useSessionPersistence` | `saveSession`、`saveWorktreeState`、`saveSessionPartial`、相关 refs（wslEntriesRefForSave, remoteEntriesRefForSave, worktreeStateRef, wtSaveTimerRef, sidebarWidthSaveTimeout）+ saveSidebarWidth, saveSideTerminalWidth | ~50 |
| `useAppCallbacks` | `handleSelectLocalAgent`、`handleOpenIdeCallback`、`handleBackToMainTerminal`、`handleOpenWorktreeTerminal`、`handleSaveProjectSettings`、`handleWslDiffBack`、`handleRemoteDiffBack`、`handleRemoteAuthCancel`、`handleRemoteAuthSuccess`、UI callbacks（toggle settings/menu, add project/wsl/remote clicks） | ~100 |
| `useSideTerminalState` | sideTerminalOpenSet/setSideTerminalOpen、focusedSideTerminalIndex、handleOpenSideTerminal、handleOpenWslSideTerminal、handleOpenRemoteSideTerminal、emptySideTerminalSet | ~25 |
| `useAppRefSync` | 25 行 ref 同步 useEffect（14+ refs） | ~25 |

## Acceptance Criteria

* [ ] App.tsx 缩减到 ~250-300 行
* [ ] 所有现有功能保留
* [ ] `npx tsc --noEmit` 通过
* [ ] `pnpm test` 通过
* [ ] 不引入新依赖

## Definition of Done

* 类型检查通过
* 现有测试全部通过
* 手动冒烟测试：本地、WSL、远程项目流程正常

## Technical Approach

### 方案 A：专注 Hook 提取

保留现有的领域 hook（`useLocalProjects`、`useWslProjects`、`useRemoteProjects`、`useWorktreeState`）不变，仅从 App.tsx 提取编排逻辑为新 hook。

每个新 hook 的接口设计：

#### useSessionPersistence
```ts
// 输入：ref sources（wsl/remote entries ref）
// 返回：saveSession, saveWorktreeState, saveSidebarWidth, saveSideTerminalWidth, 
//       wslEntriesRefForSave, remoteEntriesRefForSave, worktreeStateRef
```

#### useAppCallbacks
```ts
// 输入：所有需要的状态 setters 和 refs
// 返回：所有 handle* 回调（分组为 local/wsl/remote/auth/ui）
```

#### useSideTerminalState
```ts
// 输入：activeProjectIdRef, setSideTerminalOpenMap
// 返回：sideTerminalOpenSet, setSideTerminalOpen, focusedSideTerminalIndex, 
//       setFocusedSideTerminalIndex, handleOpenSideTerminal, handleOpenWslSideTerminal, handleOpenRemoteSideTerminal
```

#### useAppRefSync
```ts
// 输入：所有需要同步的状态值
// 返回：无（纯副作用，同步 ref）
```

## Decision (ADR-lite)

**Context**: App.tsx 575 行，编排逻辑与 hook 调用混杂，难以维护
**Decision**: 采用方案 A——提取 4 个专注 hook，保留现有领域 hook 不变
**Consequences**: 
- 最小化风险，不改变数据流
- 不使用 `useUnifiedProjects`（可在未来单独处理）
- Props 列表不变（Prop drilling 是预期模式）

## Out of Scope

* 引入 Context API 或状态管理库
* 修改 Props 下传架构
* 重构子组件（ProjectSidebar、MainContent、TitleBar）
* 使用/替换 `useUnifiedProjects` hook
* 性能优化（除了结构自然带来的改进）

## Technical Notes

### 涉及文件
- `src/App.tsx` — 重构目标
- `src/hooks/useSessionPersistence.ts` — 新文件
- `src/hooks/useAppCallbacks.ts` — 新文件
- `src/hooks/useSideTerminalState.ts` — 新文件
- `src/hooks/useAppRefSync.ts` — 新文件

### 约束
- React 18，无外部状态库
- 所有传给子组件的回调必须用 `useCallback` 包裹
- Ref 镜像模式用于稳定回调读取当前状态
- 新 hook 遵循 `hook-guidelines.md` 的命名导出函数模式
