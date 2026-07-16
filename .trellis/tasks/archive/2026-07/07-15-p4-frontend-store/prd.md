# P4: 前端类型 + Store 统一

## Goal

消除前端三种项目类型的分裂。定义统一的 `Project` 接口（携带 `ProjectEnvironment`），合并 `useProjectStore` 为存储所有项目的单一 store，简化 `useConnectionStore` 为仅存连接管理状态（对话框、Auth）。

## Requirements

1. 新建/更新统一 `Project` 类型定义（含 `environment: ProjectEnvironment`）
2. 定义 `ProjectEnvironment` 类型，对齐 Rust 端枚举结构
3. 删除 `WSLProject`、`RemoteProject`、`WSLEntrySession`、`RemoteEntrySession` 前端接口（但仍用于 session 持久化 API 类型）
4. 扩展 `useProjectStore`：`projects: Project[]` 包含所有项目类型
5. 简化 `useConnectionStore`：仅保留 `pendingAuthEntry`、对话框状态、连接发现结果
6. 删除 `LocalConnectionContext` / `WslConnectionContext` / `RemoteConnectionContext` 类型
7. 更新 `ConnectionContext` 联合类型（或删除）
8. 更新 `ActiveProjectContext`：移除 `connectionContext` 字段（从 `project.environment` 推导）
9. 更新 `ProjectView` 简化为直接使用 `Project`

## Acceptance Criteria

- [ ] 统一 `Project` 类型包含 `environment` 字段，涵盖三种运行环境
- [ ] `useProjectStore` 的 `projects` 数组可包含任意环境类型的项目
- [ ] `useConnectionStore` 不再导出 `wslEntries` / `remoteEntries` / `activeWslProject` / `activeRemoteProject`
- [ ] `ActiveProjectContext` 无 `connectionContext` 字段
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` 通过（部分测试可能需要在 P7 更新）

## Dependencies

- 与 P3 是上下游关系（P4 不能先于 P3 上线，但可以并行开发）
