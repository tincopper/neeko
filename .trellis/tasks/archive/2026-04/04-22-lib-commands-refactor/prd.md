# app.rs 命令注册重构

## Goal

重构 `src-tauri/src/app.rs` 中过长的命令注册列表。命令按现有子模块拆分为注册宏，新增命令时仅调整对应子模块，不再修改 `app.rs`，并同步更新 `AGENTS.md` 以反映真实目录结构。

## 背景

当前 `app.rs` 的 `invoke_handler` 列表已超过 100 个命令，随着 skill 命令加入仍在增长。每次新增命令都需要修改 `app.rs`，模块职责边界不清晰。

## Requirements

1. 按命令域拆分注册宏，并优先复用现有目录结构

2. `app.rs` 仅保留宏调用，不再维护详细命令列表

3. 宏调用语法统一为 `crate::xxx_commands!()`

4. 保持现有命令功能、签名与前端调用名不变

5. 更新 `AGENTS.md` 中后端模块职责描述

## Acceptance Criteria

- [ ] `src-tauri/src/commands/mod.rs` 提供 `core_commands!` 聚合宏，用于本地域命令注册

- [ ] `src-tauri/src/commands/wsl.rs` 提供 `wsl_commands!` 宏

- [ ] `src-tauri/src/commands/remote.rs` 提供 `remote_commands!` 宏

- [ ] `src-tauri/src/skill/commands.rs` 提供 `skill_commands!` 宏

- [ ] `src-tauri/src/app.rs` 的 `generate_handler!` 只保留宏调用，不出现具体命令标识符

- [ ] 新增一个 WSL 命令时，仅需调整 `commands/wsl.rs` 与该命令实现文件，`app.rs` 无改动

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过

- [ ] `pnpm tauri dev` 正常启动

- [ ] `AGENTS.md` 文档已更新

## Technical Approach

### 核心方案：在现有子模块上拆分 `macro_rules!`

每个命令域导出自己的命令列表宏，并在 `app.rs` 聚合调用。宏定义内部使用 `$crate` 路径，调用侧使用 `crate::...`。

```rust
// commands/wsl.rs
#[macro_export]
macro_rules! wsl_commands {
    () => {
        $crate::commands::get_wsl_distros,
        $crate::commands::get_wsl_directories,
        $crate::commands::get_wsl_home_dir,
        $crate::commands::create_wsl_terminal_session,
        $crate::commands::refresh_wsl_git_info,
        // ...
    };
}
```

```rust
// app.rs
    .invoke_handler(tauri::generate_handler![
        crate::core_commands!(),
        crate::wsl_commands!(),
        crate::remote_commands!(),
        crate::skill_commands!(),
    ])
```

### 拆分粒度约束

当前仓库本地域命令已分散在 `project.rs`、`git.rs`、`terminal.rs`、`file.rs`、`ide.rs`、`agent.rs`、`config.rs`。本次改造不新增 `commands/local.rs`，改为在 `commands/mod.rs` 提供 `core_commands!` 聚合宏，避免目录结构与现状冲突。

### 技术约束

1. `#[tauri::command]` 生成隐藏的 `__cmd__<函数名>` wrapper

2. `generate_handler!` 基于命令路径尾段解析 wrapper

3. 现有 `pub use module::*` 导出方式继续保留

4. 宏在编译期展开，无运行时开销

### 决策记录

**Context**: `app.rs` 命令注册列表过长，需要拆分

**Decision**: 采用 `#[macro_export]` 声明式宏，按命令域拆分并在 `app.rs` 聚合

**Consequences**:

- 优点：新增命令只调整对应域模块，`app.rs` 变更频率显著下降

- 优点：宏仅在编译期展开，运行时成本不变

- 缺点：需要维护多个注册宏与聚合边界

- 备选方案：维持现状，或继续集中在单文件维护长列表

## Out of Scope

- 不改变任何命令的业务逻辑与签名

- 不重构 `ProjectManager` 等顶层 Manager 组织

- 不调整 `utils/` 目录结构

- 不引入与命令注册无关的后端重构

## Technical Notes

### 涉及文件

- `src-tauri/src/app.rs` - `invoke_handler` 改为宏聚合调用

- `src-tauri/src/commands/mod.rs` - 新增 `core_commands!` 宏

- `src-tauri/src/commands/wsl.rs` - 新增 `wsl_commands!` 宏

- `src-tauri/src/commands/remote.rs` - 新增 `remote_commands!` 宏

- `src-tauri/src/skill/commands.rs` - 新增 `skill_commands!` 宏

- `AGENTS.md` - 更新后端命令注册描述

### 验证方式

1. `cargo check --manifest-path src-tauri/Cargo.toml` - 编译检查

2. `cargo test --manifest-path src-tauri/Cargo.toml` - 回归测试

3. `pnpm tauri dev` - 启动验证命令注册正常

4. 手动调用本地、WSL、Remote、Skill 各一条代表命令，确认 IPC 可用

### 参考资料

- Tauri `generate_handler!` 源码：`core/tauri-macros/src/command/handler.rs`

- Stack Overflow 讨论：[How to re-export Tauri command function from Rust module](https://stackoverflow.com/questions/76577953)

- Tauri Issue #11447：[Need to use multiple invoke_handlers](https://github.com/tauri-apps/tauri/issues/11447)