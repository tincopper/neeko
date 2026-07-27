# Implement：文件操作 command 拆分

## 执行步骤

### Step 1：在 `file::commands.rs` 中新增文件操作 command

- 打开 `src-tauri/src/file/commands.rs`。
- 在 `reveal_in_file_manager` 相关代码之后，新增一个 `// ── File operations ──` 分区。
- 从 `git/commands.rs` 复制 5 个函数的实现：
  - `read_dir_tree`
  - `read_file_content`
  - `write_file_content`
  - `create_new_file`
  - `save_new_file`
- 添加必要的导入：
  ```rust
  use crate::project::types::{FileContent, FileNode};
  use crate::AppError;
  use crate::AppStateWrapper;
  use tauri::State;
  ```
- 保留 `DEFAULT_TREE_DEPTH` 常量（从 `git/commands.rs` 迁移）。

### Step 2：清理 `git::commands.rs`

- 删除上述 5 个函数及 `DEFAULT_TREE_DEPTH` 常量。
- 检查并清理 `FileContent`、`FileNode` 导入，若 `git/commands.rs` 中无其他用途则移除。
- 保留其余 Git 命令和导入不变。

### Step 3：更新 `lib.rs` 的命令注册

- 在 `neeko_invoke_handler!` 宏中：
  - 移除 `git::commands` 块中关于文件操作的 5 行。
  - 在 `// ── file ──` 区域中，将 `reveal_in_file_manager` 与新增的 5 个命令放在一起。

### Step 4：编译验证

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- 修复所有编译错误。

### Step 5：测试验证

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
```

- 全部通过。

## 回滚点

- 若编译失败无法快速修复，可 `git checkout -- src-tauri/src/git/commands.rs src-tauri/src/file/commands.rs src-tauri/src/lib.rs` 回滚，再重新分析。

## 完成检查清单

- [ ] `file::commands.rs` 包含 5 个新增 command 且能编译。
- [ ] `git::commands.rs` 不再包含这 5 个 command。
- [ ] `lib.rs` 的宏注册已调整。
- [ ] `cargo check` 通过。
- [ ] `cargo test` 通过。
- [ ] `npx tsc --noEmit` 通过。
