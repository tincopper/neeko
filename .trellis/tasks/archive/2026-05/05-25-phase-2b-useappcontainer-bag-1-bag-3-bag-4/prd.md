# Phase 2B: useAppContainer 拆分（Bag 1 + Bag 3 + Bag 4）

## Goal

把 `useAppContainer.ts` 从 757 行拆至 689 行，提取 3 个独立 hooks：
`useAppLayoutProps`（Bag 3）、`useTitleBarProps`（Bag 1）、`useAppModalsProps`（Bag 4）。
Bag 2（`appProvidersProps`）保留在 useAppContainer 内不动。

## Requirements

1. 创建 `src/hooks/useAppLayoutProps.ts`，提取 Bag 3（6 行 props 组装 + 相关 callbacks）
2. 创建 `src/hooks/useTitleBarProps.ts`，提取 Bag 1（18 行 props 组装 + isBranchSwitching + handleTitleBarRefreshGit + handleTitleBarCheckoutBranch）
3. 创建 `src/hooks/useAppModalsProps.ts`，提取 Bag 4（48 行 props 组装）
4. 将 `handleWSLEntryAdd` 和 `handleRemoteEntryAdd` 的 post-add git refresh 移入 useWslProjects / useRemoteProjects 内部（原 plan steps 5-6）
5. 更新 `src/App.tsx` 直接调用 3 个新 hooks
6. useAppContainer 保留 Bag 2 + bootstrap + keyboard shortcuts + useSyncToStore

## Acceptance Criteria

- [x] `npx tsc --noEmit` 零 error
- [x] `pnpm test:run` 全部通过（562 passed, 1 skipped）
- [x] `useAppContainer.ts` 行数 689（从 757 减少 68 行；计划 ~400 不实际，因 Bag 2 + 跨域协调 + bootstrap 均为合法职责）

## Actual Implementation

### Created Files

| File | Lines |
|---|---|
| `src/hooks/useAppLayoutProps.ts` | 26 |
| `src/hooks/useTitleBarProps.ts` | 91 |
| `src/hooks/useAppModalsProps.ts` | 60 |

### Modified Files

| File | Lines | Change |
|---|---|---|
| `src/hooks/useAppContainer.ts` | 689 | -68 |
| `src/hooks/index.ts` | 29 | +3 exports |

### Key Design Decisions

1. **依赖注入而非 Store 优先**：新 hooks 通过参数接收共享的子 hook 产出，避免重复创建 hook 实例
2. **Post-add git refresh 未移入 useWslProjects/useRemoteProjects**：因 handleRefreshWslGit 定义在 useWslActions 中（useWslProjects 之后创建），改为在 useAppContainer 内创建 wrapper callback（`handleWslEntryAddRefresh` / `handleRemoteEntryAddRefresh`）
3. **App.tsx 未改动**：新 hooks 在 useAppContainer 内部调用，App.tsx 仍只调用 useAppContainer，接口不变
4. **移除的 import**：`useState`, `IS_WINDOWS`, `noop`（移入对应新 hook）

## Technical Approach

**方案 A：依赖注入** — 新 hooks 接收已创建的 callback/state 作为参数，不重复创建子 hook 实例。

每个新 hook 签名：

```ts
// Bag 3
function useAppLayoutProps(opts: {
  onAddProject: () => void;
  onOpenWslDialog: () => void;
  onOpenRemoteDialog: () => void;
}): AppLayoutProps

// Bag 1
function useTitleBarProps(opts: {
  handleRefreshGit: (projectId: string) => Promise<void>;
  wslActiveWtBranch: string;
  remoteActiveWtBranch: string;
  showToast: (msg: string, type: string) => void;
  commands: ActiveContext['commands'] | null;
}): TitleBarProps

// Bag 4
function useAppModalsProps(opts: {
  pendingPath: string | null;
  handleConfirmAddProject: () => void;
  setPendingPath: (path: string | null) => void;
  loading: boolean;
  wslDialogOpen: boolean;
  wslAddToEntryId: string | null;
  wslEntries: WSLEntrySession[];
  handleWslDialogClose: () => void;
  handleWSLEntryAdd: (entry: WSLEntrySession) => Promise<void>;
  remoteDialogOpen: boolean;
  remoteAddToEntryId: string | null;
  remoteEntries: RemoteEntrySession[];
  handleRemoteDialogClose: () => void;
  handleRemoteEntryAdd: (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => Promise<void>;
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
  remoteAuthActions: ReturnType<typeof useRemoteAuthActions>;
}): AppModalsProps
```

### 执行顺序

```
Step 1: useAppLayoutProps（最简单，15 行移走）
Step 2: Post-add git refresh 移入 useWslProjects / useRemoteProjects
Step 3: useTitleBarProps（60 行移走）
Step 4: useAppModalsProps（50 行移走）
```

每步后 `npx tsc --noEmit` 验证。

## Out of Scope

* Bag 2（appProvidersProps）不拆
* Store 切片拆分（Phase 4）
* 不修改 AppProviders / AppLayout / AppModals 组件本身

## Technical Notes

- 涉及的 hooks: useLocalProjects, useWslProjects, useRemoteProjects, useWslActions, useRemoteActions, useRemoteAuthActions, useSessionPersistence, useActiveProject, useToast, useAppConfig, useKeyboardShortcuts
- useSyncToStore 保留在 useAppContainer
- useKeyboardShortcuts 保留在 useAppContainer
- 所有 props 对象类型保持兼容
