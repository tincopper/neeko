# P2: 后端 ProjectManager 统一 + resolve_project

## Goal

将当前仅存储本地项目的 `ProjectManager` 扩展为统一管理 **所有** 项目类型（Local + WSL + Remote）的中心存储。Session 加载时自动将 `wsl_entries` / `remote_entries` 转为带 `ProjectEnvironment` 的 `Project` 注入 `ProjectManager`。新增 `AppStateWrapper::resolve_project()` 方法，供 git 等命令通过 `project_id` 一站式获取 `(GitTransport, PathBuf)`。

## Requirements

1. `ProjectManager` 新增 `add_wsl_project()` / `add_remote_project()` 方法
2. `ProjectManager::get_project()` 可查找任意类型项目（现有签名不变）
3. Session 加载逻辑（`session/manager.rs`）加载时：
   - 将 `WSLEntrySession` 中的 `WSLProjectSession` 转为 `Project { environment: Wsl { distro }, .. }`
   - 将 `RemoteEntrySession` 中的 `RemoteProjectSession` 转为 `Project { environment: Remote { ... }, .. }`
   - 写入 `ProjectManager`
4. Session 保存逻辑保存时：
   - 按 `project.environment` 类型分流回 `SessionStore` 的 `wsl_entries` / `remote_entries` / `projects`
   - 保证持久化格式与之前一致（向后兼容）
5. `AppStateWrapper` 新增 `resolve_project(project_id: &str) -> Result<(GitTransport, PathBuf), AppError>`
   - 查找 `ProjectManager` → 提取 `ProjectEnvironment::to_git_transport()` + `path`
6. `session.json` 磁盘格式 **不变**，仅在运行时层做适配

## Acceptance Criteria

- [ ] `ProjectManager` 可以存储三种类型项目，`get_project()` 按 `project_id` 查到任意类型
- [ ] Session 加载：旧 session.json 加载后，WSL/Remote 项目可通过 `get_project()` 查到
- [ ] Session 保存：保存后 session.json 格式与之前完全一致（diff 检查）
- [ ] `resolve_project()` 返回正确的 `GitTransport` + path
- [ ] `cargo check` 通过
- [ ] `cargo test` 通过

## Dependencies

- P1（`core::ProjectEnvironment`）必须先完成
- 被 P3 依赖（P3 调用 `resolve_project()`）
