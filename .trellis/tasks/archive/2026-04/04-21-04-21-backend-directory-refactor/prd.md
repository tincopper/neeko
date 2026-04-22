# backend: 优化 src-tauri/src 目录结构

## Goal

将 `src-tauri/src/` 的目录结构与 Tauri 2 + Rust 最佳实践对齐，解决当前 `lib.rs` 职责过重、缺少统一错误类型、目录命名语义不清 3 个问题，使后端代码的长期可维护性提升。

## What I already know

- `lib.rs` 当前 274 行，同时承担：模块声明、`AppStateWrapper` 定义、`run()` 函数、Tauri Builder 配置、setup 闭包、事件监听、命令注册表。职责远超出「模块导出」。
- 大量命令返回 `Result<T, String>`（`skill/commands.rs` 中有 20+ 处，`commands/` 其他模块也普遍使用），错误信息以字符串形式丢失分类信息。
- `state/` 目录实际存放的是纯数据结构（`Project`、`GitInfo`、`FileChange`、`TerminalSession` 等），语义上更接近「数据模型」而非「运行时状态」。运行时状态 `AppStateWrapper` 却放在 `lib.rs` 中。
- `lib.rs` 中存在乱码注释（第 76 行），需要清理。
- `resolve_user_path()` 辅助函数放在 `lib.rs` 中，与模块导出职责无关。
- `commands/` 目录已按领域拆分（`git.rs`、`project.rs`、`remote.rs`、`wsl.rs` 等），结构良好，无需改动。
- `skill/` 目录自成体系（`commands.rs`、`skill_store.rs`、`types.rs` 等），结构良好。

## Assumptions (temporary)

- 本次优化以「结构调整 + 基础设施搭建」为主，不改动业务逻辑。
- `state/` 重命名为 `models/` 后，所有引用该模块的 `use crate::state::...` 需要同步更新。
- 统一错误类型创建后，现有命令的 `Result<T, String>` 可以逐步迁移，不必一次全部替换。
- `AppStateWrapper` 建议保留在独立文件 `app_state.rs` 中，而非混入 `models/`。

## Open Questions

1. **范围确认**：3 个改动（lib.rs 拆分、error.rs 创建、state/ 重命名）是否全部在本次任务中完成？
2. **error.rs 迁移范围**：创建 `error.rs` 后，是否需要将本次涉及的所有命令（尤其是 `skill/commands.rs` 中的 20+ 处）从 `Result<T, String>` 迁移到 `Result<T, AppError>`，还是仅搭建基础设施，后续任务再逐步迁移？
3. **state/ 重命名**：是否接受将 `state/` 重命名为 `models/`？这会触发约 15+ 个文件的 import 路径变更。

## Requirements (evolving)

### 必需（MVP）

- [ ] 将 `lib.rs` 中的启动逻辑（`run()`、Tauri Builder、setup 闭包、事件监听、命令注册表）提取到独立的 `app.rs`（或 `bootstrap.rs`）中。
- [ ] `lib.rs` 仅保留模块声明和必要的 re-export，恢复为「模块导出入口」的单一职责。
- [ ] 将 `AppStateWrapper` 从 `lib.rs` 移动到独立的 `app_state.rs` 中。
- [ ] 创建 `src-tauri/src/error.rs`，使用 `thiserror` 定义可序列化的统一错误类型 `AppError`。
- [ ] 修复 `lib.rs` 中的乱码注释。
- [ ] 将 `resolve_user_path()` 移动到更合适的模块（如 `utils/`）。

### 可选（视用户确认）

- [ ] 将 `state/` 目录重命名为 `models/`，同步更新所有引用。
- [ ] 将 `skill/commands.rs` 中的 `Result<T, String>` 迁移为 `Result<T, AppError>`。
- [ ] 将 `commands/` 中其他模块的 `Result<T, String>` 迁移为 `Result<T, AppError>`。

## Acceptance Criteria

* [ ] `lib.rs` 行数控制在 50 行以内（仅模块声明 + re-export）。
* [ ] `cargo check` 通过，无编译错误。
* [ ] `cargo test` 通过，无测试失败。
* [ ] 前端 `pnpm tauri dev` 能正常启动，功能无回归。
* [ ] `error.rs` 中 `AppError` 已实现 `serde::Serialize`，可被 Tauri 序列化传递到前端。

## Definition of Done

- 代码通过 `cargo check` 和 `cargo test`。
- 前端 `pnpm tauri dev` 验证无回归。
- 相关 spec 文档更新（如 backend/directory-structure.md）。
- PR 保持最小改动，不混入业务逻辑变更。

## Out of Scope (explicit)

- 不改动任何业务逻辑或命令行为。
- 不新增或删除任何 Tauri 命令。
- 不改动 `commands/` 目录内部结构。
- 不改动 `skill/` 目录内部结构。
- 不引入新的外部依赖（`thiserror` 除外，若项目未引入）。

## Technical Approach

### Step 1: lib.rs 拆分

1. 新建 `app.rs`，将 `run()`、Tauri Builder、setup 闭包、`on_window_event`、`invoke_handler` 全部移入。
2. 新建 `app_state.rs`，将 `AppStateWrapper` 和 `new()` / `new_with_skill_store()` 移入。
3. `lib.rs` 保留 `mod` 声明和 `pub use` re-export。
4. `main.rs` 不变，继续调用 `neeko_lib::run()`。

### Step 2: error.rs 创建

1. 新建 `error.rs`，定义：

```rust
use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Serialize)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Git error: {0}")]
    Git(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Skill error: {0}")]
    Skill(String),
    #[error("Project error: {0}")]
    Project(String),
    #[error("Not found")]
    NotFound,
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl From<std::io::Error> for AppError { ... }
impl From<anyhow::Error> for AppError { ... }
// 其他 From 实现
```

2. 在 `lib.rs` 中声明 `pub mod error;`。
3. （可选）迁移部分命令使用 `AppError`。

### Step 3: state/ 重命名为 models/

1. 将 `state/` 目录重命名为 `models/`。
2. 更新 `lib.rs` 中的 `mod state;` 为 `mod models;`。
3. 全局搜索 `use crate::state::` 并替换为 `use crate::models::`。
4. 更新 `state/mod.rs` 为 `models/mod.rs`。

### Step 4: 清理

1. 修复 `lib.rs` 第 76 行乱码注释。
2. 将 `resolve_user_path()` 移动到 `utils/path.rs` 或 `utils/env.rs`。

## Technical Notes

- 项目使用 `anyhow::Result` 作为内部错误处理，与 `thiserror` 的 `AppError` 可以共存：`anyhow` 用于内部传播，`AppError` 用于命令边界序列化。
- `state/` 重命名会触发约 15+ 个文件的 import 更新，但都是纯机械替换，无逻辑变更。
- `skill/commands.rs` 有 736 行，是 `Result<T, String>` 最密集的区域。若全部迁移，改动量较大，建议分步。
- `lib.rs` 中的乱码注释内容为 `// Unix: 浠庣敤鎴?login shell 鑾峰彇瀹屾暣 PATH...`，疑似编码问题，应修复为正确的中文或英文。

## Decision (ADR-lite)

**Context**: `lib.rs` 职责过重，同时承担模块导出、状态定义、应用启动 3 种职责，违反单一职责原则。`Result<T, String>` 丢失错误分类，不利于前端错误处理。

**Decision**:
1. `lib.rs` 仅保留模块导出，启动逻辑提取到 `app.rs`，状态定义提取到 `app_state.rs`。
2. 引入 `thiserror` 定义 `AppError`，作为命令边界的统一错误类型。
3. `state/` 重命名为 `models/`，明确其为数据契约层。

**Consequences**:
- 正：目录结构更清晰，与 Tauri 社区最佳实践对齐；错误类型可扩展；新成员更容易理解代码组织。
- 负：`state/` 重命名会触发大量文件的 import 变更，需要一次全局替换。
- 风险：`AppError` 的 `From` 实现若覆盖不全，可能导致编译错误；需要逐步迁移现有命令。
