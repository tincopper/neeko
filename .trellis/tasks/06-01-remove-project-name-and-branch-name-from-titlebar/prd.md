# PRD: 去掉顶部栏的项目名和分支名

## 问题

`src/layout/TitleBar.tsx` 左侧信息区除了 Neeko 图标外还渲染了：

1. 当前项目名（带 avatar + 名称文本）
2. 当前分支切换器（`TitleBarBranchSwitcher`）

用户希望简化顶部栏视觉负载，移除这两块信息。Neeko 图标保留（作为窗口可拖拽区的视觉锚点和应用标识）。

## 方案

仅修改 `src/layout/TitleBar.tsx` 一个文件：
- 移除项目名 `<span>` 块（lines 140-152）
- 移除分支切换器 `<TitleBarBranchSwitcher />` 调用（lines 153-162）
- 清理随之不再需要的 props：`activeWorktreeBranch`、`activeWslWorktreeBranch`、`activeRemoteWorktreeBranch`、`branches`、`isBranchSwitching`、`onCheckoutBranch`、`activeProject`、`activeWslProject`、`activeRemoteProject`、`onRefreshGit`（仅在 TitleBar 内部使用部分）
- 同步清理 `currentProjectName`、`currentBranch`、`isWorktreeMode` 等派生变量
- 同步清理 `handleNewBranch` / `handleDialogClose` / `handleDialogRefreshGit` 中对 `activeProject`/`activeWslProject`/`activeRemoteProject` 的依赖——这些原本只服务于分支切换对话和新分支流程，连同移除

注意：`handleNewBranch` 同时也是新分支对话框的入口。移除后 TitleBar 自身不再持有 `dialogState`，相关 dialog 也需要从 TitleBar 中移除（dialog 仅由"新建分支"触发，没有其他入口）。但需要排查 `GitDialog` 是否有其他入口——若有，应保留并从其他位置挂载。

## 改动文件

- `src/layout/TitleBar.tsx` — 移除项目名 + 分支切换器，清理 props/state/handlers
- 可能影响：上游 `App.tsx` / `useAppContainer` 需相应移除传给 TitleBar 的 props

## 改动内容

| 位置 | 改动 |
|---|---|
| `TitleBar.tsx` props | 删除 `activeProject` / `activeWslProject` / `activeRemoteProject` / `activeWorktreeBranch` / `activeWslWorktreeBranch` / `activeRemoteWorktreeBranch` / `branches` / `isBranchSwitching` / `onCheckoutBranch` / `onRefreshGit` |
| `TitleBar.tsx` 派生 | 删除 `currentProjectName` / `currentAvatarColor` / `currentBranch` / `isWorktreeMode` |
| `TitleBar.tsx` handlers | 删除 `handleNewBranch` / `handleDialogClose` / `handleDialogRefreshGit` 和 `dialogState` |
| `TitleBar.tsx` JSX | 删除项目名 span + `TitleBarBranchSwitcher`；删除底部 `<GitDialog>` 挂载 |
| `TitleBar.tsx` imports | 删除 `TitleBarBranchSwitcher` / `GitDialog` / `DialogState` / `Project`/`WSLProject`/`RemoteEntrySession`/`RemoteProject` types / `useDockStore`(?) / `getAvatarStyle` / `getProjectInitials` 等不再使用的 import |
| `App.tsx` 调用 | 同步更新传参 |

## 边界确认

- 顶部栏左侧 spacer / 拖拽区宽度计算依赖 `DOCK_BAR_WIDTH + leftPanelWidth + 2` 的逻辑在 left panel 关闭时不影响，需要确认移除项目名后视觉是否仍合理
- `neekoIcon` import 保留

## 验证

- `pnpm lint`
- `pnpm type-check`
- 视觉确认：dev 启动后顶部栏只剩 Neeko 图标 + 拖拽区 + 右侧 OpenIdeButton / TaskRunButton / WindowControls

## Definition of Done

- TitleBar 顶部不再显示项目名和分支切换器
- TypeScript 类型检查通过
- Lint 通过
- 无未使用的 import 或死代码遗留
