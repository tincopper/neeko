# C1: 持久化 schema 扁平化

> Parent: [07-16-env-scatter-cleanup](../07-16-env-scatter-cleanup/prd.md)

## Goal

将 `sessions.json` 的 `wsl_entries` / `remote_entries` 分离结构扁平化为单一 `projects: Project[]` 列表（每项携带 `environment`）。这是整条链路的**根因锚点**——schema 分裂从后端一路顶到前端，强制维持了三套并行的 struct / hook / context / store。扁平化后，C2-C5 的合并才有基础。

## Background

当前数据流（三路分裂）：

```
后端 session/types.rs          前端
  ProjectSession          ┐
  WSLProjectSession       ├─ sessions.json ─→ saveSessionApi(projects, wsl, remote)
  WSLEntrySession         │                     connection/store.ts: wslEntries / remoteEntries
  RemoteProjectSession    │
  RemoteEntrySession      ┘
```

`session/manager.rs` 的 `collect_wsl_projects` / `collect_remote_projects` 把统一的 `Project[]` 又拆回 `WSLEntrySession` / `RemoteEntrySession`；`create_session_from_projects` 用 `matches!(p.environment, Local)` 过滤。前端 `ProjectsPanel` 再把统一列表手动 re-group 成 `wslGroups`/`remoteGroups`/`localProjects`。

## Requirements

### 后端

- `session/types.rs`：以 `ProjectSession`（携带 `environment` + 可选 `connection` 元数据）为单一持久化项类型，移除 `WSLProjectSession` / `WSLEntrySession` / `RemoteProjectSession` / `RemoteEntrySession`（或收敛为一个 `ConnectionSession` 仅存连接建立信息：host/port/username/auth/distro）
- `SessionStore` 顶层字段改为扁平 `projects: Vec<ProjectSession>` + `connections: Vec<ConnectionSession>`（连接建立信息与项目解耦）
- `session/manager.rs`：删除 `collect_wsl_projects` / `collect_remote_projects`，`create_session_from_projects` 不再按 environment 分流
- **旧格式迁移**：加载旧 `sessions.json`（含 `wsl_entries`/`remote_entries`）时一次性迁移为新扁平格式，所有持久化字段 `#[serde(default)]`，写 serde 往返单测覆盖旧格式反序列化
- `project/mod.rs`：三个 `add_*_from_session` 合并为单个 `add_project_from_session(session: ProjectSession)`，内部按 `session.environment` 构造

### 前端

- `session/types.ts`：`SessionData` 改为扁平 `projects` + `connections`
- `sessionApi.ts` / `useSessionPersistence.ts`：`saveSession` 只传扁平列表，不再传 `(projects, wsl, remote)` 三元组
- `connection/store.ts`：移除 `wslEntries` / `remoteEntries`，改为消费统一 `projects` + 连接建立信息

## Constraints

1. **向后兼容**：用户现有的 `~/.neeko/sessions.json`（旧三段格式）必须能无损加载并迁移，不得 panic、不得丢字段（selected_agent / selected_ide / avatar_color）
2. **WSL 门控**：`ProjectEnvironment::Wsl` 仅 `cfg(target_os = "windows")`；迁移逻辑在非 Windows 平台遇到 wsl_entries 需优雅处理（保留数据或忽略，不 panic）
3. **连接与项目解耦**：SSH host/auth、WSL distro 属于"连接建立"信息，项目只引用连接 id，避免每个项目重复存 transport

## Acceptance Criteria

- [ ] `sessions.json` 新格式为扁平 `projects[]`，无 `wsl_entries`/`remote_entries`
- [ ] 旧格式 sessions.json 加载迁移单测通过（含缺字段、含三种项目类型）
- [ ] `session/types.rs` 不再有 `WSL*Session` / `Remote*Session` 并行结构
- [ ] `project/mod.rs` 只有单个 `add_project_from_session`
- [ ] 前端 `saveSession` 签名不再区分 wsl/remote
- [ ] `cargo test` + `pnpm test:run` + `cargo check` + `npx tsc --noEmit` 全绿

## Dependencies

- 无（这是根因，应最先做）。C2/C3/C4/C5 均依赖本 task 完成后的扁平 schema。
