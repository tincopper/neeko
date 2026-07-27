# PRD：拆分文件操作 command 出 git/commands.rs

## 背景

后端的通用文件系统操作（读目录树、读文件、写文件、创建文件）目前和大量 Git 相关命令混放在 `src-tauri/src/git/commands.rs:580-660` 中。虽然这些文件操作的实际业务逻辑已经独立在 `src-tauri/src/common/file/services.rs`，但它们的 Tauri command 入口层仍挂在 `git::commands` 模块下，导致 `git/commands.rs` 职责不纯，也不符合项目“模块职责清晰”的后端规范。

## 目标

将 `git/commands.rs` 中的文件操作相关 Tauri command 拆分至独立的 `file::commands` 模块，与 `reveal_in_file_manager` 等文件操作命令并列；在 `lib.rs` 的命令注册宏中单独归类为 `// ── file ──`，保持命令集合完整且语义清晰。

## 范围

### 包含

- 迁移以下 5 个 command 函数：
  - `read_dir_tree`
  - `read_file_content`
  - `write_file_content`
  - `create_new_file`
  - `save_new_file`
- 调整 `src-tauri/src/git/commands.rs` 的导入和导出，移除已迁移函数。
- 在 `src-tauri/src/file/commands.rs` 中实现并导出这些函数。
- 在 `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!` 宏中，将这 5 个命令从 `git::commands` 块移动到 `file::commands` 块。
- 保持前端调用方式不变（Tauri invoke 的命令名即函数名，迁移后命令名不变）。

### 不包含

- 不改动 `common::file::services.rs` 中的实现逻辑。
- 不新增或删除任何业务功能。
- 不改前端 invoke 调用点（本次仅后端模块重组）。

## 验收标准

1. `src-tauri/src/git/commands.rs` 不再包含 `read_dir_tree`、`read_file_content`、`write_file_content`、`create_new_file`、`save_new_file`。
2. `src-tauri/src/file/commands.rs` 包含上述 5 个 command 函数，并能在 `file::commands` 路径下被 `lib.rs` 引用。
3. `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!` 中，这 5 个命令注册在 `// ── file ──` 区域。
4. `cargo check --manifest-path src-tauri/Cargo.toml` 通过，无编译错误和警告新增。
5. 现有 Rust 单元测试（含 `file::commands` 中已有测试）全部通过：`cargo test --manifest-path src-tauri/Cargo.toml`。
6. 前端类型检查 `npx tsc --noEmit` 通过（因命令名不变，预期无影响）。

## 风险

- 风险：移动 command 时遗漏导入或宏注册，导致编译失败。
  - 缓解：`cargo check` 后立即修复。
- 风险：前端某个调用点错误地硬编码了模块路径而非命令名。
  - 缓解：Tauri 命令名与模块路径无关，且本次不改函数名；仍会通过 `npx tsc --noEmit` 和搜索确认。
