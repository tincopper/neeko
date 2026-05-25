# Phase 4: Store 切片拆分（研究结论）

## Result: BLOCKED by Zustand 5 type system

### Attempted approaches

| # | Approach | Status |
|---|---|---|
| 1 | `StateCreator<AppStoreState, [], [], Slice>` spread in `create<AppStoreState>()()` | ❌ Consumer `useAppStore(s => ...)` selectors typed as `any` |
| 2 | Factory functions with `StoreApi<AppStoreState>["setState"]` | ❌ Same issue — spread breaks TypeScript inference |
| 3 | Factory functions with `set: any` | ❌ Consumer selectors lose type information |
| 4 | Plain function spread with `create<AppStoreState>((set, get, store) => ...)` | ❌ 76 consumer type errors |

### Root Cause

Zustand 5's `create<T>()` relies on the initializer being a single expression to properly bind generic type `T`. When state+actions are split across factory functions and spread back, TypeScript cannot infer the combined return type as `T`. Consumer `useAppStore(s => s.tabs[...])` selectors lose type safety.

### Done

- [x] Domain comment separators added to `appStore.ts` (4 sections: Project, Connection, Worktree, Tabs+Editor)
- [x] `npx tsc --noEmit` 零 error
- [x] `pnpm test:run` 562 passed

## Acceptance Criteria

- [x] `npx tsc --noEmit` 零 error
- [x] `pnpm test:run` 全部通过
- [ ] `appStore.ts` 行数 < 100 → **不可行**（Zustand 5 类型系统限制）

## Out of Scope

* 切片拆分需等待 Zustand 6 或改用其他状态管理方案
* `useSyncToStore` 删除推迟
* `useState` → store 迁移推迟
