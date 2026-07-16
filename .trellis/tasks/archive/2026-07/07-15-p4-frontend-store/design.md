# P4 Design: 前端 Store 统一

## 新类型定义

应在 `src/core/types/` 或 `src/shared/types/` 下新建（建议 `src/shared/types/project.ts`）：

```typescript
// ─── ProjectEnvironment ───

export type ProjectEnvironment =
  | { type: "Local" }
  | { type: "Wsl"; distro: string }
  | { type: "Remote"; host: string; port: number; username: string; auth: AuthMethod };

// ─── Project ───

export interface Project {
  id: string;
  name: string;
  path: string;
  environment: ProjectEnvironment;
  git_info: GitInfo | null;
  terminal: TerminalSession;
  selected_agent: string | null;
  selected_ide: string | null;
  active_view: ViewMode;
  collapsed: boolean;
  avatar_color?: string | null;
}
```

## useProjectStore 扩展

```typescript
interface ProjectStoreState {
  projects: Project[];          // ← 现在包含所有项目类型
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  selectProject: (id: string) => void;
  openIde: (project: IdeProject) => void;
  setProjectIde: (projectId: string, ideCommand: string | null) => void;
  patchChangedFiles: (projectId: string, diff: FileDiff) => void;
  // 新增
  addProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  setProjects: (projects: Project[]) => void;
}
```

## useConnectionStore 简化

```typescript
interface ConnectionStoreState {
  // 只保留连接管理
  pendingAuthEntry: RemoteEntrySession | null;
  wslDistros: string[];          // WSL 发现结果（非项目）
  remoteEntriesMeta: RemoteEntryMeta[]; // 连接列表（不含项目）
  wslDialogOpen: boolean;
  remoteDialogOpen: boolean;
  remoteAuthDialogOpen: boolean;
}
```

> **注意**：`RemoteEntrySession` / `WSLEntrySession` 等 session 持久化类型仍需保留（供 `sessionApi.ts` 使用），但 store 不再存储它们。

## ActiveProjectContext 简化

```typescript
interface ActiveProjectContext {
  project: Project | null;       // 统一类型，非 ProjectView
  commands: ProjectCommands | null;
  capabilities: ProjectCapabilities | null;
  worktreePath: string | null;
  isLoading: boolean;
  // connectionContext 移除
}
```

原消费者如需 connection 细节（host, port, username），从 `project.environment` 推导：

```typescript
function getRemoteConnection(project: Project): { host: string; port: number; username: string } | null {
  if (project.environment.type === "Remote") {
    return project.environment;
  }
  return null;
}
```

## 迁移策略

1. 先在 `src/shared/types/` 中定义新 `Project`/`ProjectEnvironment` 类型
2. 扩展 `useProjectStore` 方法（在旧字段旁边加新字段）
3. 简化 `useConnectionStore`：先保留旧字段但标记 `@deprecated`，新增新字段
4. 所有消费者逐步迁移到统一 store 后，删除 `useConnectionStore` 的旧字段
5. 最后删除 `WSLProject`/`RemoteProject`/`connectionContext` 类型

## 受影响的主要文件

| 文件 | 变更 |
|------|------|
| `src/features/project/types.ts` | 重定义 Project，删除 ConnectionContext |
| `src/features/connection/types.ts` | 删除 WSLProject/RemoteProject（保留 session 类型） |
| `src/features/project/store.ts` | 扩展 projects 为所有类型 |
| `src/features/connection/store.ts` | 简化，只留连接管理 |
| `src/shared/types/project.ts` | 更新重导出 |
| `src/shared/types/connection.ts` | 移除或大幅缩减 |
