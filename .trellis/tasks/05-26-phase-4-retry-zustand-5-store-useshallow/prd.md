# Phase 4-Retry: Zustand 5 store 性能优化

## Goal

用 `useShallow` 优化高频对象/数组 selector，减少不必要的 re-render。

## Target files

| File | Selector | Change |
|---|---|---|
| `useTerminalTabs.ts:29` | `s => s.tabs` | → `useShallow(s => s.tabs)` |
| `DockBarButton.tsx:68` | `s => s.tabs` | → `useShallow(s => s.tabs)` |
| `useLocalProjects.ts:13` | `s => s.projects` | → `useShallow(s => s.projects)` |
| `useWslActions.ts:39` | `s => s.wslEntries` | → `useShallow(s => s.wslEntries)` |
| `useRemoteProjects.ts:13` | `s => s.remoteEntries` | → `useShallow(s => s.remoteEntries)` |
| `useRemoteActions.ts:34` | `s => s.remoteEntries` | → `useShallow(s => s.remoteEntries)` |
| `useWorktreeState.ts:19` | `s => s.worktreeStateMap` | → `useShallow(s => s.worktreeStateMap)` |
| `useFileView.ts:57` | `s => s.fileTree` | → `useShallow(s => s.fileTree)` |
| `useFileView.ts:82` | inline computed | → 拆分 + useShallow |
| `MainContent.tsx:57` | inline computed | → 拆分 + useShallow |

## Acceptance Criteria

- [ ] `npx tsc --noEmit` 零 error
- [ ] `pnpm test:run` 全部通过
- [ ] 零 API 变更
