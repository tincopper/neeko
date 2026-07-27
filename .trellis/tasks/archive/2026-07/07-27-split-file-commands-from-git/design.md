# Design：文件操作 command 拆分

## 模块边界

```
src-tauri/src/
├── common/
│   └── file/
│       └── services.rs      # 文件操作业务实现（保持不变）
├── file/
│   ├── mod.rs               # 已存在，导出 commands 和 watcher
│   └── commands.rs          # 新增：文件操作 Tauri command 入口
└── git/
    └── commands.rs          # 移除文件操作 command，保留 Git 相关 command
```

## 数据流

1. 前端通过 `invoke('read_file_content', ...)` 发起调用。
2. Tauri 根据命令名路由到 `file::commands::read_file_content`（此前为 `git::commands::read_file_content`）。
3. `file::commands::read_file_content` 调用 `crate::common::file::services::read_file_content(...)` 完成实际业务。
4. 对 WSL/Remote 场景，services 层再通过 `exec_on` 分发到对应后端。

命令名不变，前端无需任何修改。

## 依赖与导入

### `file::commands.rs` 需要

```rust
use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;
```

并复用 `crate::common::file::services` 中的函数。

### `git::commands.rs` 移除后

- 移除 `FileContent`、`FileNode` 的导入（若没有其他用途）。
- 移除 `DEFAULT_TREE_DEPTH` 常量（已迁移到 `file::commands`）。

## 命令注册

在 `lib.rs` 的 `neeko_invoke_handler!` 宏中，将：

```rust
// unified file operations
$crate::git::commands::read_dir_tree,
$crate::git::commands::read_file_content,
$crate::git::commands::write_file_content,
$crate::git::commands::create_new_file,
$crate::git::commands::save_new_file,
```

改为：

```rust
// ── file ──────────────────────────────────────────────────────────
$crate::file::commands::reveal_in_file_manager,
$crate::file::commands::read_dir_tree,
$crate::file::commands::read_file_content,
$crate::file::commands::write_file_content,
$crate::file::commands::create_new_file,
$crate::file::commands::save_new_file,
```

## 兼容性

- Tauri `generate_handler!` 只关心函数是否标记 `#[tauri::command]`，不关心所在模块。
- 命令名默认等于函数名，因此前端调用无需变更。
- `file::mod.rs` 已经 `pub use commands::*;`，外部可通过 `file::commands::xxx` 引用。

## 测试策略

- 编译检查：`cargo check --manifest-path src-tauri/Cargo.toml`
- 单元测试：`cargo test --manifest-path src-tauri/Cargo.toml`，确保 `file::commands` 中已有测试仍通过。
- 前端类型检查：`npx tsc --noEmit`，确认命令名未变导致类型不匹配。
