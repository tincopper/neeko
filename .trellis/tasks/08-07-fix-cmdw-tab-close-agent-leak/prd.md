# 修复 build 后 Cmd+W 关闭 tab 失效与 Agent 进程残留

## Goal

1. **Cmd+W 关闭 tab 在 build（release）后完全无反应**，dev 下正常。需要让 dev/build 行为一致：Cmd+W 关闭当前 tab 而非窗口。
2. **X 关闭 Agent tab 后，本地 Agent 进程残留**。Rust 端 `close_terminal_session` → SIGTERM/SIGKILL 进程组已执行（日志确认），但 Agent（或其派生子进程）脱离 PTY 进程组，未被终止。

## Requirements

### 问题 1：Cmd+W 关闭 tab
- R1.1 build 下按 Cmd+W（macOS）关闭当前 tab，窗口保持打开（与 dev 一致）。
- R1.2 无活跃 tab 时 Cmd+W 不应关闭窗口。
- R1.3 红色关闭按钮仍正常关闭整个窗口（不经 Cmd+W 逻辑）。
- R1.4 Windows/Linux 的 Ctrl+W 行为不回退。
- R1.5 遵循 `.trellis/spec/backend/window-lifecycle.md` 约束：不引入新的 AtomicBool 来源标记；`close-tab` 监听永不调用 `destroy()`；关闭按钮走 `.destroy()`。

### 问题 2：Agent 进程残留（本地项目）
- R2.1 关闭任意 Agent/terminal tab 后，该 PTY 会话的全部存活进程（含脱离进程组的孙进程）应被终止，不留孤儿。
- R2.2 不误杀其他 PTY 会话或 Neeko 自身的进程。
- R2.3 Windows 沿用 Job Object 路径不回退；macOS/Linux 补进程树兜底。
- R2.4 WSL/SSH 关闭路径（remote_terminal_manager）回归不受影响。

## Acceptance Criteria

- [ ] build 后 macOS 按 Cmd+W 关闭当前 tab、窗口保持（用户手工验证 + 诊断日志确认触发链路）
- [ ] 红色关闭按钮关闭窗口（回归）
- [ ] Rust 单元测试覆盖进程树终止逻辑（构造脱离进程组的子进程，关闭后确认被杀）
- [ ] 复现 Agent 残留后确认：关闭 tab 后 `ps -p <agent_pid>` 不再存在（用户手工验证）
- [ ] 前端 keydown 兜底路径在 dev 下测试仍通过（`useKeyboardShortcuts.test.ts` 等）
- [ ] `cargo test` / `pnpm test:run` / `pnpm type-check` / `pnpm lint` 全绿

## Notes

- 根因基于日志（`~/.neeko/neeko.log` 12:10–12:15 build 测试段）确认：`close_terminal_session` 被调用、SIGTERM/SIGKILL 进程组执行正常，残留进程在进程组之外。
- 问题 1 需要诊断驱动：build 下 `on_menu_event` 是否触发、`close-tab` 事件是否到达前端、前端 keydown 是否收到，决定修复方案（见 design.md）。
- Agent 通过 `sendToTerminal`（`terminalCommands.ts`）写入命令字符串到 PTY 启动，是 shell 子进程。
- `close_pty_handle` / `graceful_kill` 运行在独立 OS 线程（`pty-close-*`），进程枚举（libproc/procfs）可安全放置，不违反"同步桥禁止 async 线程"红线。
