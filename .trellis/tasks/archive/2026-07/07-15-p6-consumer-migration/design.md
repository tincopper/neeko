# P6 Design: 消费者迁移

## 分组迁移

### 组 A：项目选择/列表（4 文件）

| 文件 | 重构策略 |
|------|---------|
| `useProjectList.ts` | 从统一 `useProjectStore` 读取，不再 merge 三个源 |
| `useProjectSelection.ts` | 改为 `useProjectStore.setProjectId(id)` |
| `useCrossTypeSelection.ts` | 废弃，逻辑并入 `useProjectSelection.ts` |
| `useKeyboardShortcuts.ts` | 方向键导航改为遍历统一 `projects` 数组 |

### 组 B：应用壳（2 文件）

| 文件 | 重构策略 |
|------|---------|
| `useAppShell.ts` | 去掉 `useWslProjects`/`useRemoteProjects`/`useCrossTypeSelection`，session 初始化直接设置 `useProjectStore` |
| `MainContent.tsx` | 去掉三路条件渲染，统一用 `project.environment.type` 判断 |

### 组 C：编辑器（3 文件）

| 文件 | 重构策略 |
|------|---------|
| `useFileView.ts` | 去掉从 `activeWslProject`/`activeRemoteProject` 获取 path，改为 `project.environment`/`project.path` |
| `FileViewer.tsx` | 从 `useProjectStore` 获取 project |
| `EditorGroupPane.tsx` | 从 `WslContext` 迁移到 `project.environment` |

### 组 D：Git（2 文件）

| 文件 | 重构策略 |
|------|---------|
| `useAheadBehindSync.ts` | 从 `useConnectionStore` 改用 `useActiveProject().project` |
| `GitLogPanel.tsx` | 同上 |

### 组 E：Agent（2 文件）

| 文件 | 重构策略 |
|------|---------|
| `useAgentActions.ts` | 废弃 WSL/Remote 项目条件分支，统一用 project ID 操作 |
| `useAgentClickHandler.ts` | 从 `activeWslProject`/`activeRemoteProject` 迁移到 `useActiveProject().project` |

### 组 F：Layout（4 文件）

| 文件 | 重构策略 |
|------|---------|
| `OpenIdeButton.tsx` | 从 `useConnectionStore` 迁移到 `useActiveProject().project` |
| `DockPanelWrappers.tsx` | 同上 |
| `DockBarButton.tsx` | 同上 |

### 组 G：Terminal（4 文件）

| 文件 | 重构策略 |
|------|---------|
| `strategies/local.ts` | `openFileInEditor` 不再构造 transport，传 `projectId` |
| `strategies/wsl.ts` | 同上，不再从 `WslContext` 读取 distro |
| `strategies/remote.ts` | 同上，不再构造 Remote transport |
| `terminalLinks.ts` | `FileTransportKind` → `projectId` |

### 组 H：Context Providers（2 文件）

| 文件 | 重构策略 |
|------|---------|
| `WslContext.tsx` | 移除 activeWslProject/activeWslKey，只保留 WSL 可用性状态 |
| `RemoteContext.tsx` | 同理，只保留连接状态 |

### 组 I：Session（2 文件）

| 文件 | 重构策略 |
|------|---------|
| `useSessionBootstrap.ts` | session 加载后直接设置 `useProjectStore.setProjects()` |
| `useSessionPersistence.ts` | 从 `useProjectStore` 读取全量项目，按 environment 分流保存 |

### 组 J：其他（3 文件）

| 文件 | 重构策略 |
|------|---------|
| `ProjectsPanel.tsx` | 三列（local/WSL/Remote）→ 保留但数据源统一从 `useProjectStore` 读取 |
| `useRemoteActions.ts` | 创建远程项目后追加到 `useProjectStore` |
| `useWslActions.ts` | 创建 WSL 项目后追加到 `useProjectStore` |

## 迁移模式

### 当前模式（分裂）

```typescript
const activeProject = useProjectStore((s) => s.activeProject);
const activeWslProject = useConnectionStore((s) => s.activeWslProject);
const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
// 三路优先级合并...
```

### 新模式（统一）

```typescript
const { project, commands } = useActiveProject();
// 所有场景通过 project.environment 差异化
if (project.environment.type === "Wsl") { /* WSL 特有逻辑 */ }
if (project.environment.type === "Remote") { /* SSH 特有逻辑 */ }
```
