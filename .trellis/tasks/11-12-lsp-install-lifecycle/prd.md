# LSP 安装与项目移除生命周期

## Goal

让「装在哪、判据查哪、什么时候装、删项目时怎么拆」四件事各自只有一个答案：安装产物与
可用性判据在**同一环境**；安装不再阻塞会话装配；项目删除真的把语言服务器拆掉。

## Background

审计证据见 `.trellis/tasks/11-12-lsp-graceful-shutdown/research/audit-orchestration.md`：

- `plugin/builtins/java_install.rs:44` 把 jdtls 装到 `$HOME/.neeko/bin`，而
  `installer.rs:110-121` 的可用性判据是 `command -v jdtls`；只有 Local 的
  `host_path::prepend_neeko_bin` 会置顶该目录 ⇒ **WSL / SSH 上装完仍判「未安装」**，每轮会话创建
  重下 ~100MB 再报 "installed but still not found"（P2 原则被违反：判据与消费点不同环境）。
- `session/instance.rs:127-160` 的自动安装跑在**装配同步路径**（per-key gate 内、命令 await 中）：
  前端 initialize 15s 先超时显示失败，安装仍在后台跑；安装期该语言所有请求排队。
- `installer.rs:20-31,125-152` 的 `INSTALL_IN_PROGRESS` 只按 `language_id` 去重 ⇒ 两个项目并发
  同语言时后者硬失败，并被包装成「请手动安装: Install already in progress」（跨 target 本可并行）。
- `project/commands.rs:32-57` 的 `remove_project` 完全不碰 LSP：不 `close_sessions_for_project`、
  不 `evict_project`、不 `profiles.remove` ⇒ 删项目后 jdtls JVM / rust-analyzer 活到应用退出；
  同路径重新添加时 `is_alive` 会复用旧进程（旧 exec target、旧会话根）。

## Requirements

- **R1（判据与产物同环境，止血版）**：安装产物落在**目标环境**的 `$HOME/.neeko/bin`，而判据只看
  目标 PATH（Local 由 `host_path::prepend_neeko_bin` 置顶，WSL/SSH 没有）⇒ 远端每轮会话创建都
  重下 ~100MB。改为：PATH 查不到时，**按绝对安装路径**再判一次（`$HOME/.neeko/bin/<bin>`，
  经目标 shell 展开，`command_exists` 在 WSL/SSH 上本来就是 `command -v` 脚本形态）。
  命中即视为已安装 → 不再重复下载，并在失败文案里明确「已装但不在 PATH，请把
  `~/.neeko/bin` 加入目标环境 PATH」。
- **R2（去重键含 target）**：`INSTALL_IN_PROGRESS` 从 `HashSet<String>`（仅 language_id）改为
  `(language_id, target)`；**同键并发改为等待**而不是硬失败（当前返回
  `Err("Install already in progress")`，被包装成「请手动安装」）。
- **R3（删除项目必须拆 LSP）**：`project/commands.rs::remove_project` 现在只关终端 + 停 watcher。
  改为在删除前取出项目路径，删除后调 `lsp_manager.close_sessions_for_project(path)`
  （它已包含 close + profiles.remove + `attempt_diag.evict_project` 三件事）。

> 范围修正（2026-11-12）：原 R2「安装移出会话装配路径」被拆出 —— 现状**没有任何显式安装入口**
> （`InstallProgressBridge` 消费的进度事件也由装配期安装发出），移出装配等于同时新增一个安装命令 +
> 前端入口 + 进度接线，是特性而非修复。原 R1 的完整形态（把 `~/.neeko/bin` 注入**每个目标**的
> LSP exec env，让远端 spawn 也能按名字解析到包装脚本）需要平台门面 + 每目标 PATH 读取，
> 与红线 10（平台差异落 `platform/`）同族，单独立项。

## Acceptance Criteria

- **AC1**：`check_binary_installed` 在 PATH 缺失但目标 `$HOME/.neeko/bin/<bin>` 存在时返回 `true`
  （测试用假 ExecTarget / 注入的探测结果，不真起远端）。
- **AC2**：`INSTALL_IN_PROGRESS` 键为 `(language, target)`：同语言不同 target 可并行；
  **同键**第二次调用等待第一次结束并成功（不再返回 "Install already in progress"）。
- **AC3**：`remove_project` 后该项目 LSP 会话全部关闭（断言 store 里该 path 无会话 /
  `close_sessions_for_project` 被调用），且 `profiles` / 诊断键被驱逐（既有实现保证）。
- **AC4**：`cargo test --lib` 全绿；既有 `remove_project` 的项目管理测试语义不变。

## Out of scope

- 安装脚本本身的下载源/版本选择策略（`java_install.rs` 的 milestone 解析）。
- `-data` 归属（jdtls workspace 目录）。
- **显式安装入口**：把安装移出装配路径需要新命令 + 前端入口 + 进度接线（特性，另立项）。
- **远端 exec env 的 PATH 注入**：让远端 spawn 也能按名字解析 `~/.neeko/bin` 下的包装脚本。
  需要平台门面（红线 10）+ 每目标 PATH 读取 + 缓存；与本次「止血」（不再重复下载）分开做。
