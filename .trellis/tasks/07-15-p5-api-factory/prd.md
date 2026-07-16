# P5: 前端 API + Factory 迁移

## Goal

前端 git/file API 函数不再接受 transport 参数，改为只传 `projectId`。`commandFactory.ts` 简化为直接构造 `projectId` 参数，不再需要 transport 序列化逻辑。`use-active-project` hook 去掉跨 store 合并和 connectionContext 构造。

## Requirements

1. `gitApi.ts`：所有函数（~30 个）去掉 `transport: GitTransportKind` 参数，invoke 时只传 `{ projectId, ... }`
2. `fileApi.ts`：`read_file_content` / `read_dir_tree` / `write_file_content` 去掉 `transport: FileTransportKind` 参数
3. 删除 `gitApi.ts` 中的 `LocalTransport` / `WslTransport` / `RemoteTransport` / `GitTransportKind` / `FileTransportKind` 类型定义
4. `commandFactory.ts`：
   - 删除 `GitTransportKind` 类型定义
   - 删除 `transportArg()` / `fileTransportArg()` 函数
   - `createProjectCommands(transport)` → `createProjectCommands(projectId)`
   - 所有方法直接 invoke 并传 `{ projectId, ... }`
5. `use-active-project/index.ts`：
   - 去掉从三个 store 读取 transport 的逻辑
   - 去掉优先级合并（remote > wsl > local）
   - `createProjectCommands(transport)` → `createProjectCommands(project.id)`

## Acceptance Criteria

- [ ] `gitApi.ts` 无 transport 类型定义，所有函数签名不含 transport
- [ ] `fileApi.ts` 无 transport 参数
- [ ] `commandFactory.ts` 无 transportArg/fileTransportArg 函数
- [ ] `createProjectCommands(projectId)` 工作正常
- [ ] `useActiveProject` 返回的 `commands` 可用
- [ ] `pnpm type-check` 通过

## Dependencies

- P3（后端命令签名变更）必须完成，否则前端 invoke 的参数不匹配
- P4（前端统一 Project 类型）建议先完成，确保 Project.id 存在
