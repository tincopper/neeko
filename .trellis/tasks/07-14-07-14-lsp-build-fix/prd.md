# 构建模式 LSP 不可用修复

## Goal

修复 LSP server 在 Tauri 桌面进程中的二进制查找和启动问题。核心矛盾是 `check_server_installed` 使用 interactive shell PATH 检查通过，但 `Command::new` 使用进程 PATH 找不到 binary。

只覆盖 **local 项目**。WSL/SSH 项目的 LSP 启动不在本 task 范围内。

## Root Cause

`src-tauri/src/lsp/manager.rs:199` 用 `Command::new(cmd[0])` 通过 binary name 启动进程，依赖 Tauri 进程的 PATH。macOS GUI app bundle 的进程 PATH 是系统默认值，不包含用户 shell 中的 fnm/nvm 追加路径。

而 `check_server_installed`（`installer.rs:69`）调用的 `check_command_exists`（`local.rs:41-47`）走的是 **interactive shell**（`zsh -i -c 'echo $PATH'`），能正确找到 fnm 路径下的 `typescript-language-server`。

结果：检查通过 → spawn 失败 → "Failed to spawn LSP server"。

### 涉及的路径差异

- 用户 shell PATH 示例：`~/.local/share/fnm/node-versions/v24.17.0/installation/bin`
- Tauri 进程 PATH：**不包含上述路径**
- `resolve_full_path()`（`local.rs:144-161`）只加了 nvm 路径（`~/.nvm/versions/node/current/bin`），没加 fnm 路径

## Requirements

### 1. 诊断日志增强

在以下关键节点新增日志输出，使后续可通过日志直接定位问题：

- **`app.rs` resolve_user_path**：记录 resolve 前后的 `PATH` 完整值
- **`LspSession::new()`**：在 spawn LSP server 前记录 `PATH`、binary 名、resolved 绝对路径、完整命令
- **`installer.rs` `check_server_installed`**：记录查找的 binary 名和结果，以及当前 `PATH`
- **`installer.rs` `install_server_impl`**：记录安装命令和输出

日志格式统一为 `[LSP][{module}] {message}`，便于过滤。

### 2. 修复 server 启动 — 引入 `exec_from_path`

在 `common/utils/command/local.rs` 中新增公共函数：

```rust
/// Create a Command with full PATH resolution.
/// Merges process PATH with user shell paths (fnm, nvm, homebrew, etc.)
/// so GUI-launched processes can find npm/node global binaries.
pub fn exec_from_path(program: &str) -> Command {
    let resolved = resolve_command_path(program, &resolve_full_path());
    exec(&resolved)
}
```

调用点修改（仅 local 项目路径）：

- `lsp/manager.rs:204`：`Command::new(cmd[0])` → `exec_from_path(cmd[0])`
- `lsp/installer.rs:137`：`Command::new(cmd_and_args[0])` → `exec_from_path(cmd_and_args[0])`

其他 `Command::new` 调用点（git、gh、open 等）不改——系统 command 已在进程 PATH 中。

### 3. LSP 错误 UI 通知

所有 LSP 错误走用户可见通知，不再静默吞掉。涉及路径：

- `TauriLspTransport.send()` `.catch()` → toast
- `useLspDefinition.goToDefinition*()` catch → toast
- `useLspDefinition.findReferences()` catch → toast
- `useLspCapabilities` `.catch()` → toast
- `lspHoverExtension` 无 `.catch()` → 补充
- `StatusBar` 重启/停止 catch → toast
- `FileViewer` F12/Cmd+Click `.then()` 无 `.catch()` → 补充

现有 toast 系统：`src/shared/hooks/useToast.ts` + `AppToast`。

### 4. URI 解析加固

`commands.rs` 中 `trim_start_matches("file://")` 改为 `strip_prefix("file://")`，避免字符级别的误匹配。

## Non-Requirements

- LSP 可配置化（server 列表、自定义 server 等）不在本 task 范围内，后续单独处理
- **WSL 项目 LSP**：需要检测 WSL 路径并通过 `wsl.exe -d <distro>` 桥接 stdin/stdout，不在本 task 范围内
- **SSH 项目 LSP**：需要 SSH 长连接 + LSP 协议转发，不在本 task 范围内

## Known Limitation — WSL/SSH LSP Gap

LspManager 当前完全假设 local-only。`get_or_create_session` 只接受 `project_path` + `language_id`，没有项目来源信息。对于 WSL/SSH 项目：

| 来源 | LSP server 位置 | 通信方式 | 状态 |
|---|---|---|---|
| Local | 本机，与 Neeko 同机 | `Command` + stdin/stdout pipe | 本 task 修复 |
| WSL | WSL 容器内 | 通过 `wsl.exe -d <distro>` 桥接 stdin/stdout | ❌ 未支持 |
| SSH | 远程服务器 | 通过 SSH 通道 forwarding LSP protocol | ❌ 未支持 |

WSL 下的 LSP 理论上可以走 `wsl.exe` pipe，SSH 需要 `russh` 长连接 + channel data 转发。两者都需要在 LspManager 层引入 `ProjectSource` 概念——目前项目系统没有统一的来源枚举：本地在 `ProjectManager`，WSL/SSH 在 `SessionStore.wsl_entries`/`SessionStore.remote_entries`。

未来需要：
1. 引入 `ProjectSource` 枚举（Local / WSL { distro } / SSH { host, port, username, auth }）
2. LspManager 根据 source 选择不同的启动策略
3. WSL：通过 `wsl.exe -d <distro> typescript-language-server --stdio` + `.current_dir(path)` 桥接
4. SSH：复用现有 `russh` 连接 + 远程启动 + LSP 协议 data channel 转发

## Acceptance Criteria

- [ ] 构建打包后可查看日志定位 LSP 启动问题（日志包含 PATH、binary 查找、spawn 结果）
- [ ] `.ts` 和 `.tsx` 文件在 `pnpm tauri build` 后的应用中 LSP 功能正常（诊断错误线、hover 提示、跳转定义 F12）
- [ ] `rust-analyzer` 在 build 后仍然正常工作（回归保护）
- [ ] LSP server 启动失败时，用户能看到 toast 提示
- [ ] LSP transport（`lsp_transport` invoke）错误时，用户能看到 toast 提示
- [ ] `trim_start_matches("file://")` 替换为 `strip_prefix("file://")`
- [ ] local 项目 LSP 正常工作；WSL/SSH 项目不会触发 LSP 启动（不崩溃即可）

## Notes

- Rust 端错误已正确传播到 JS（`Result<T, AppError>` via Tauri IPC），问题出在 JS 层的静默吞错误
- 日志策略：info 级用于关键指标（PATH、binary 查找结果）；debug 级用于详细调试（如 install 输出）
- 使用 `grep '\[LSP\]'` 可快速过滤所有 LSP 相关日志
- 不修改 `common/utils/command/gh.rs`、`project/commands_ide.rs`、`connection/services.rs` 等系统命令调用点
