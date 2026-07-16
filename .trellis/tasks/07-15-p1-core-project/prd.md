# P1: 后端 core 模块 — Project + ProjectEnvironment

## Goal

新建 `src-tauri/src/core/` 模块，作为全应用共享的领域核心层。将 `Project` 结构体 + `ViewMode` 从 `project/model.rs` 迁入该模块，新增 `ProjectEnvironment` 枚举来描述项目运行环境（Local / WSL / Remote），使其他领域（git, session, terminal, skill）可通过统一的核心类型而非传输参数来引用项目。

## Requirements

1. 新建 `src-tauri/src/core/mod.rs` 和 `src-tauri/src/core/project.rs`
2. 定义 `ProjectEnvironment` 枚举：
   - `Local` — 本地文件系统项目
   - `Wsl { distro: String }` — 仅在 `cfg(target_os = "windows")` 下编译
   - `Remote { host, port, username, auth: AuthMethod }` — SSH 远程项目
3. 将 `Project` 结构体移入 `core/project.rs`，追加 `environment: ProjectEnvironment` 字段
4. 将 `ViewMode` enum 一并移入 `core/project.rs`
5. `project/model.rs` 移除 `Project`/`ViewMode` 定义（保留 git/PR 类型如 `GitInfo`, `FileChange`, `PRListItem` 等）
6. `project/types.rs` 改为从 `crate::core` 重新导出 `Project`/`ViewMode`
7. 所有引用 `crate::project::types::Project` / `crate::project::model::Project` 的地方更新为 `crate::core::Project`
8. `#[serde(default)]` 处理 `environment` 字段在旧 session 数据缺失时的兼容

## Acceptance Criteria

- [ ] `crate::core::Project` 可正常构造，携带 `environment` 字段
- [ ] `crate::core::ProjectEnvironment` 的序列化/反序列化正确，旧 session JSON 中无 environment 字段时回退为 `Local`
- [ ] `project/model.rs` 不再包含 `Project` 或 `ViewMode` 定义
- [ ] `cargo check` 通过，无未使用导入或类型错误
- [ ] `cargo test` 通过

## Dependencies

- 依赖 parent task `07-15-project-unification` 的全局架构设计
- 被 P2 依赖（P2 使用 `ProjectEnvironment`）
