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

- **R1**：可用性判据与安装产物同环境 —— 远端 exec env 同样置顶 `$HOME/.neeko/bin`，或判据直接查
  该绝对路径（不得只靠 PATH）。
- **R2**：安装移出会话装配（激活项目时预装/显式安装入口），装配路径只在「已可用」时继续。
- **R3**：安装去重键 = `(language_id, exec_target)`；同键并发改为**等待**而不是硬失败。
- **R4**：删除项目复用停用拆解路径（close + evict + profiles.remove），并让 exec target 变更
  使既有会话失效。

## Acceptance Criteria

- **AC1**：WSL/SSH 目标下「安装成功 ⇒ `check_plugin_installed` 为真」（用假远端 root 的单测，
  不 spawn 真实安装）。
- **AC2**：装配路径中不再出现安装调用（`rg -n 'install_plugin_server' src-tauri/src/lsp/session` 零命中）。
- **AC3**：两个项目并发同语言安装只跑一次，第二个等它完成并成功（不报「已在安装中」）。
- **AC4**：`remove_project` 后该项目的会话全部关闭、诊断键被驱逐（有测试断言 store 为空）。
- **AC5**：`cargo test --lib lsp::` 全绿；安装相关测试不得真下载。

## Out of scope

- 安装脚本本身的下载源/版本选择策略（`java_install.rs` 的 milestone 解析）。
- `-data` 归属（jdtls workspace 目录）。
