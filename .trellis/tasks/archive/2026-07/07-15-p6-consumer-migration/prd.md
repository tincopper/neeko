# P6: 前端消费者迁移

## Goal

将所有直接引用 `useConnectionStore` 获取项目数据、以及手动构造 transport 的消费者组件/hooks 迁移到统一 store 和新 API 签名。消除对废弃类型（`WSLProject`、`RemoteProject`）的依赖。

## Requirements

1. 更新 **约 50 个文件** 从 `useConnectionStore` 读取项目数据改为从 `useProjectStore` 读取
2. 更新 terminal 三个策略文件（local/wsl/remote）：不再构造 transport，改传 `projectId`
3. 更新 `useDiffData.ts`、`useFileView.ts` 去掉 transport 构造
4. 更新 `useAppShell.ts`、`MainContent.tsx`、`OpenIdeButton.tsx`
5. 更新 `DockPanelWrappers.tsx`、`DockBarButton.tsx`
6. 更新 `WslContext` / `RemoteContext` 以移除项目数据（保留连接状态）
7. 更新 `ProjectsPanel.tsx`、`EditorGroupPane.tsx`、`FileViewer.tsx`
8. 更新 `useKeyboardShortcuts.ts`、`useProjectSelection.ts`、`useProjectList.ts`
9. 折叠/废弃 `useCrossTypeSelection.ts`
10. 更新 `useAgentActions.ts`、`useAgentClickHandler.ts`
11. 更新 `useAheadBehindSync.ts`、`useWorktreeActions.ts`
12. 更新 `useSessionBootstrap.ts`、`useSessionPersistence.ts`

## Acceptance Criteria

- [ ] 所有组件从统一 store 获取项目数据
- [ ] 没有文件再直接引用 `useConnectionStore` 获取 `wslEntries`/`activeWslProject`/`activeRemoteProject`
- [ ] terminal 三个策略文件不再构造 transport
- [ ] `useCrossTypeSelection.ts` 不再需要或已废弃
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` 通过（受影响的测试在 P7 更新）

## Dependencies

- P4（前端 store 统一）
- P5（API + factory 迁移）
- 必须在 P4/P5 之后执行
