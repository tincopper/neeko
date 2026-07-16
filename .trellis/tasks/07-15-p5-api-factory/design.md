# P5 Design: API + Factory 迁移

## gitApi.ts 签名变更示例

### 重构前

```typescript
// gitApi.ts
export function stageFiles(transport: GitTransportKind, filePaths: string[]): Promise<void> {
  return invoke<void>('stage_files', { transport, filePaths });
}

export function getGitInfo(transport: GitTransportKind): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { transport });
}

// PR functions
export function listPrs(projectId: string, state: string, limit: number): Promise<PRListItem[]> {
  return invoke<PRListItem[]>('list_prs_command', { projectId, state, limit });  // ← missing transport!
}
```

### 重构后

```typescript
// gitApi.ts — 统一 projectId 模式
export function stageFiles(projectId: string, filePaths: string[]): Promise<void> {
  return invoke<void>('stage_files', { projectId, filePaths });
}

export function getGitInfo(projectId: string): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { projectId });
}

export function listPrs(projectId: string, state: string, limit: number): Promise<PRListItem[]> {
  return invoke<PRListItem[]>('list_prs_command', { projectId, state, limit });  // ← transport bug 自动修复
}
```

## commandFactory.ts 变化

### 重构前

```typescript
export type GitTransportKind = { type: "Local"; projectId: string; projectPath: string } | ...;

function transportArg(t: GitTransportKind): Record<string, unknown> {
  // 将前端 transport 序列化为 Rust 端格式
}

export function createProjectCommands(transport: GitTransportKind): ProjectCommands {
  const tp = () => transportArg(transport);
  return {
    stageFiles(filePaths: string[]) { return invoke("stage_files", { ...tp(), filePaths }); },
    getGitInfo() { return invoke("get_git_info", tp()); },
    // ...
  };
}
```

### 重构后

```typescript
export function createProjectCommands(projectId: string): ProjectCommands {
  return {
    stageFiles(filePaths: string[]) { return invoke("stage_files", { projectId, filePaths }); },
    getGitInfo() { return invoke("get_git_info", { projectId }); },
    generateCommitMessage(...) { return invoke("generate_commit_message", { projectId, agentId, filePaths }); },
    readDirTree(...) { return invoke("read_dir_tree", { projectId, rootPath, subPath, maxDepth }); },
    // ...
  };
}
```

## use-active-project 变化

### 重构前

```typescript
const commands = useMemo(() => {
  if (activeRemoteProject !== null) {
    const transport: GitTransportKind = { type: "Remote", ... };
    return createProjectCommands(transport);
  }
  if (activeWslProject !== null) {
    const transport: GitTransportKind = { type: "Wsl", ... };
    return createProjectCommands(transport);
  }
  if (activeProject !== null) {
    const transport: GitTransportKind = { type: "Local", ... };
    return createProjectCommands(transport);
  }
  return null;
}, [/* deps from 3 stores */]);
```

### 重构后

```typescript
const commands = useMemo(() => {
  if (!activeProject) return null;
  return createProjectCommands(activeProject.id);
}, [activeProject?.id]);
```

## 删除清单

从 `gitApi.ts` 删除：
- `LocalTransport` / `WslTransport` / `RemoteTransport` 接口
- `FileTransportLocal` / `FileTransportWsl` / `FileTransportRemote` 接口
- `GitTransportKind` / `FileTransportKind` 类型
- 所有函数的 `transport` 参数

从 `commandFactory.ts` 删除：
- `GitTransportKind` 类型定义
- `transportArg()` / `fileTransportArg()` 函数

从 `use-active-project/index.ts` 删除：
- 三路条件分支
- `connectionContext` 构造和缓存
- 对 `useConnectionStore` 的导入和引用
