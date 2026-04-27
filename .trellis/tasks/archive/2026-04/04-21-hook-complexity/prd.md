# Hook 复杂度治理

## Goal

降低三个核心 Hook 的认知负担和耦合度，使其易于理解、测试和维护。

## 问题分析

### 问题 1: useAppCallbacks — 巨型参数对象 + 跨域混杂

- **52 个参数**通过单一 params 对象传入
- **16 个回调**混合了 6 个不同领域：Agent/IDE、Worktree、Diff、ProjectSettings、RemoteAuth、UI Toggle
- 任何一个领域变动都会触发整个 hook 重新执行

### 问题 2: useWslActions / useRemoteActions — 结构重复

两个 hook 结构高度相似（~85% 同构）：
- 都有 diffState、worktreePath、worktreeBranch、openedWorktrees
- 都有 selectProject、selectFile、refreshGit、openIde、openWorktreeTerminal、selectAgent
- 区别仅在于：WSL 用 `distro` 参数，Remote 用 `host/port/username/auth` 参数

### 问题 3: useAppContainer — 620 行编排层

- 聚合了 15+ 个 hook 的返回值
- 大量 `useCallback` 包装仅用于跨域状态清理
- 组装 5 个 Context value 对象

## 现有架构

```
App.tsx
  └── useAppContainer() (620 行，编排一切)
        ├── useAppConfig
        ├── useLocalProjects
        ├── useWslProjects + useWslActions
        ├── useRemoteProjects + useRemoteActions
        ├── useAppCallbacks (52 params → 16 callbacks)
        ├── useWorktreeState
        ├── useTerminalTabs
        ├── useFileView
        ├── useSessionPersistence
        ├── useSyncToStore
        └── useKeyboardShortcuts
              ↓
        组装 5 个 Context value → Provider 树
```

## Requirements

### R1: 按域拆分 useAppCallbacks

将 useAppCallbacks 拆分为 3 个独立的领域 hook，每个 hook 只关心自己领域的参数：

| 新 Hook | 职责 | 原回调 | 参数来源 |
|---------|------|--------|----------|
| `useAgentActions` | Agent 切换 + IDE 打开 + 项目配置保存 | handleSelectLocalAgent, handleOpenIdeCallback, handleOpenIdeForSidebar, handleSaveProjectSettings | zustand store（activeProject, projects）+ 少量 props |
| `useWorktreeActions` | Worktree 导航 + Diff | handleBackToMainTerminal, handleOpenWorktreeTerminal, handleSelectWorktreeFile, handleWorktreeDiffBack | zustand store（activeProjectId）+ 少量 props |
| `useRemoteAuthActions` | SSH 认证流程 | handleRemoteAuthCancel, handleRemoteAuthSuccess | zustand store（pendingAuthEntry, remoteEntries）+ 少量 props |

不再需要的 hook：
- `useProjectSettingsActions` — 合并到 `useAgentActions`（同属项目配置领域）
- `useUiActions` — 不建 hook，回调直接内联到 useAppContainer（都是一行 setter 调用）
- `handleWslDiffBack` / `handleRemoteDiffBack` — 内联到 useAppContainer

**zustand store 前置步骤**：将以下状态从 `useAppContainer` 的 `useState` + `useSyncToStore` 单向同步，改为 zustand store 作为 source of truth：

| 状态 | 当前位置 | 改为 |
|------|----------|------|
| `activeProject`, `projects` | useLocalProjects useState | zustand store |
| `remoteEntries`, `activeRemoteProject` | useRemoteProjects useState | zustand store |
| `wslEntries`, `activeWslProject` | useWslProjects useState | zustand store |
| `remoteAuthStore`, `pendingAuthEntry` | useRemoteProjects useState | zustand store |

域 hook 直接通过 `useAppStore(state => state.xxx)` 读取，参数从 ~10 个降至 3-5 个。

### R2: 提取 WSL/Remote 共享逻辑

**不再使用泛型 Hook** — 对比 WSL 和 Remote 代码后发现差异过大：
- WSL 不需要 auth，Remote 需要 host/port/username/auth 四元组
- selectProject 的跨域清理逻辑不同（WSL 清 Remote 状态，Remote 清 WSL 状态）
- selectAgent 的 switchAgent 调用签名完全不同
- 泛型 config 会退化为"每个操作传一个 callback"，本质是代码搬家

改为提取真正重复的部分：

1. **`useConnectionWorktreeState()`** — 共享 diffState + worktreePath + worktreeBranch + openedWorkt 的 4 个 useState + 对应 setter（两者 100% 相同）
2. **`updateProjectInEntries(entries, projectId, updater)`** — 共享的 entries 嵌套更新逻辑（纯函数，提取到 `utils/entryUpdates.ts`）
3. **`buildRefreshGitHandler(invokeCommand, setEntries, setActiveProject)`** — 共享的 refreshGit + 更新 entries + 更新 activeProject 流程

WSL 和 Remote hook 仍然独立，但调用上述共享工具/子 hook，消除真正的重复代码。

### R3: 缩减 useAppContainer

R1 和 R2 完成后，useAppContainer 自然缩减：
- 拆分后的域 hook 各自管理参数，不再需要巨型 params 传递
- 跨域清理逻辑可内聚到各自的 selectProject handler 中
- Context value 组装提取为独立的纯函数 `buildContextValues()`

不以行数为目标，改为"每个职责可独立理解"：useAppContainer 仅负责调用 hook + 调用组装函数 + 返回 props，不再内嵌大量逻辑。

## Acceptance Criteria

- [ ] useAppCallbacks 被拆分为 3 个域 hook，原文件删除
- [ ] useAgentActions 参数数量 <= 8
- [ ] useWorktreeActions 参数数量 <= 5
- [ ] useRemoteAuthActions 参数数量 <= 8
- [ ] `useConnectionWorktreeState` 被 WSL 和 Remote actions 共同使用
- [ ] `utils/entryUpdates.ts` 存在，包含 `updateProjectInEntries` 等共享纯函数
- [ ] zustand store 作为 activeProject/projects/remoteEntries/wslEntries/remoteAuthStore 的 source of truth
- [ ] `buildContextValues()` 纯函数从 useAppContainer 提取出来
- [ ] useAppContainer 每个职责可独立理解（状态读取、跨域编排、Context 组装 分离）
- [ ] `pnpm test:run` 全部通过
- [ ] `npx tsc --noEmit` 无错误
- [ ] 功能行为不变（Agent 切换、IDE 打开、Worktree 导航、Diff 查看、SSH 认证全部正常）

## Definition of Done

- 测试通过
- TypeScript 编译通过
- 手动验证核心功能路径

## Out of Scope

- Context 膨胀问题（#5）— 单独任务
- 新增功能
- 修改组件层代码（除非 hook 接口变更要求）
- useSyncToStore 移除（暂时保留双写，后续单独清理）

## Technical Notes

### 关键文件

- `src/hooks/useAppCallbacks.ts` (262 行, 52 params, 16 callbacks)
- `src/hooks/useWslActions.ts` (141 行)
- `src/hooks/useRemoteActions.ts` (173 行)
- `src/hooks/useAppContainer.ts` (620 行, 编排层)
- `src/store/appStore.ts` (zustand, 目前仅为单向同步快照)
- `src/contexts/` (5 个 Context Provider)

### 约束

- 不引入新的状态管理库（扩展 zustand store 作为 source of truth）
- 保持现有 Context Provider 接口不变（消费侧无感）
- 渐进式重构：可分 PR 交付
- 先完成 store 迁移（R1 前置步骤），再做 hook 拆分

## Decision (ADR-lite)

**Context**: useWslActions 和 useRemoteActions 有 ~85% 结构重复，需要选择消除方式。
**Decision**: 不使用泛型 Hook，改为提取共享子 hook + 纯函数工具。原因：WSL/Remote 的差异点过多（auth、跨域清理、switchAgent 签名），泛型 config 会退化为 callback 传递，失去抽象价值。
**Consequences**: WSL/Remote hook 仍独立存在，但共享状态管理（worktreeState）和共享逻辑（entryUpdates, refreshGit）集中维护，消除真正的重复代码。

## Implementation Plan (可分 PR)

### PR 1: zustand store 提升为 source of truth
- 扩展 `src/store/appStore.ts`，将 `activeProject/projects/remoteEntries/wslEntries/remoteAuthStore` 提升为 source of truth
- `useLocalProjects`、`useRemoteProjects`、`useWslProjects` 改为读写 store（不再各自 useState）
- 移除 `useSyncToStore` 的单向同步逻辑
- 测试验证：所有功能行为不变

### PR 2: 提取共享子 hook + 工具函数
- 新建 `src/hooks/useConnectionWorktreeState.ts`（共享 4 个 useState）
- 新建 `src/utils/entryUpdates.ts`（共享纯函数）
- `useWslActions` 和 `useRemoteActions` 改为使用共享子 hook
- 测试验证：WSL/Remote 功能不变

### PR 3: 拆分 useAppCallbacks
- 新建 `useAgentActions`（含项目配置保存）
- 新建 `useWorktreeActions`
- 新建 `useRemoteAuthActions`
- 内联 UI 回调 + Diff back 到 useAppContainer
- 删除 `useAppCallbacks.ts`
- 测试验证：Agent/IDE/Worktree/Auth 功能不变

### PR 4: 缩减 useAppContainer
- 提取 `buildContextValues()` 纯函数
- 跨域清理逻辑内聚到各自的 selectProject handler
- 测试验证：所有 Context value 结构不变
