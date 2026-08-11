# 收敛命令执行三重枚举 · 技术设计

## 1. 核心判断

`GitTransportKind` 与 `ExecTarget` 字段逐一相同，`GitTransportKind` 没有任何增量信息，其唯一存在理由是「实现 `GitTransport`」。因此直接让 `ExecTarget` 实现 `GitTransport`，删除 `GitTransportKind`。这是 `impl Trait for data-type` 的标准 Rust 惯用法（让数据类型的核心抽象直接实现，而非包一层包装 enum）。

保留 `ProjectEnvironment`（持久化领域模型）与 `ExecTarget`（运行时调度键）两个类型，单向转换，职责不同不合并。

## 2. 变更点逐文件

### 2.1 `common/git/transport.rs`

- **删除** `GitTransportKind` enum（当前 195-215 行）。
- **删除** `GitTransport::exec_target()` trait 方法（189 行）——transport 本身即 `ExecTarget`，无需再掏。
- `impl GitTransport for GitTransportKind`（220-565 行）改为 `impl GitTransport for ExecTarget`：
  - match 臂 `GitTransportKind::Local` → `ExecTarget::Local`
  - match 臂 `GitTransportKind::Wsl { distro }` → `ExecTarget::Wsl { distro }`（去掉 `#[cfg(target_os = "windows")]` 门控，因 `ExecTarget::Wsl` 全平台存在）
  - match 臂 `GitTransportKind::Remote { .. }` → `ExecTarget::Remote { .. }`
  - 各臂内部 `create_executor(&ExecTarget::...)` 改为 `create_executor(self)`（`ExecTarget: Clone`），Wsl/Remote 分支不再重复构造 ExecTarget（直接解构 self）
  - `run_git_opts` 的 Local 臂 `create_executor(&ExecTarget::Local)` → `create_executor(self)`
  - `run_git_with_stdin` 同理
  - **删除** `exec_target()` 实现（545-564 行）
- 逻辑**逐行平移**，不改变任何行为。
- `#[cfg(test)]` 中 `GitTransportKind::Local` 改为 `ExecTarget::Local`。

### 2.2 `core/project.rs`

- **删除** `ProjectEnvironment::to_git_transport()`（46-71 行）。
- 保留 `to_exec_target()`。

### 2.3 `app_state.rs`

- import：`use crate::common::git::transport::{GitTransport, GitTransportKind};` → `use crate::common::executor::factory::ExecTarget;`
- `resolve_project()` 返回类型 `Result<(Arc<dyn GitTransport>, String), AppError>` → `Result<(ExecTarget, String), AppError>`
- 函数体：
  ```rust
  let target = project.environment.to_exec_target();
  Ok((target, path))
  ```

### 2.4 `file/commands.rs`（8 处）

`let (t, wd) = state.resolve_project(&project_id)?; let target = t.exec_target();`
→
`let (t, wd) = state.resolve_project(&project_id)?; let target = &t;`
（`t` 现在是 `ExecTarget`；`read_dir_tree` 等接收 `&ExecTarget`）

### 2.5 `agent/commands_commit.rs`（1 处）

`match t.exec_target() { ExecTarget::Local => ..., ExecTarget::Remote { ref host, ... } => ... }`
→
`match &t { ... }`（匹配引用，借用字段，避免 move）

### 2.6 `git/commands.rs`（约 60 处）

- `let (t, wd) = state.resolve_project(&project_id)?;` 的 `t` 类型由 `Arc<dyn GitTransport>` 变为 `ExecTarget`
- 传给 `operations::xxx(&*t, ...)`（接收 `&dyn GitTransport`）→ `operations::xxx(&t, ...)`（`&ExecTarget` 自动 coerce 到 `&dyn GitTransport`）
- `let target = t.exec_target();` → `let target = &t;`
- `t.is_git_repo(&wd)` 保持（`ExecTarget: GitTransport`）

## 3. 类型自动强转说明

`operations.rs` 全部签名接收 `&dyn GitTransport`。`&t`（`&ExecTarget`）到 `&dyn GitTransport` 是**无大小强制转换**（unsized coercion），自动发生，无需手动 `as`。

## 4. 编译期完整性

删除 `GitTransportKind` 后，任何残留引用都会在编译期报错。`cargo check` + `cargo clippy -D warnings` 兜底。

## 5. 边界（不迁移）

- `ProjectEnvironment` 与 `ExecTarget` 不合并（职责不同，见 PRD）。
- 不重命名 `ExecTarget`。
- Wsl `#[cfg]` 门控不一致不在本任务统一（`ExecTarget::Wsl` 全平台存在是既有事实，本任务不改）。
- `operations.rs` 的 `&dyn GitTransport` 签名保持（可后续单独考虑改泛型，本任务不扩大面）。

## 6. 兼容性与回滚

- **纯删除 + 平移**：无签名行为变化，只删类型、改调用点。
- **回滚**：单任务独立提交，若回归可整体 revert。

## 7. 风险与决策

| 风险 | 决策 |
|------|------|
| 调用点约 100 处，改动面大 | 分文件逐一处理，`cargo check` 增量验证 |
| Wsl 臂 cfg 门控移除 | `ExecTarget::Wsl` 全平台存在，行为不变（运行期对非 Windows 返回错误，与既有 ExecTarget 一致） |
| 误改逻辑 | 严格逐行平移，不重写；`cargo test` 全绿验证 |
