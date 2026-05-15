# Task: exit-cleanup-optimization

## Overview

优化 Neeko 退出链路，解决“窗口关闭时卡几秒”的体验问题。  
核心策略：窗口销毁不再同步阻塞清理，改为后台并行清理 terminal / remote / watcher，清理结束后兜底强制退出进程。

## Background

当前退出问题主要来自以下链路：

- `src-tauri/src/app.rs` 的 `on_window_event(Destroyed)` 同步调用 `terminal_manager.close_all_sessions()`
- `close_all_sessions()` 逐个关闭本地 PTY 会话，并等待 `graceful_kill()`
- 当前 `GRACEFUL_TIMEOUT_SECS = 3`，多会话叠加会导致明显延迟
- 当前只清理本地 PTY，没有同步清理 remote / watcher
- 若残留线程继续运行，进程可能在窗口关闭后仍挂住

## Requirements

### R1. 退出策略改为“窗口先关，后台清理”

- 窗口销毁事件中不再执行同步阻塞清理
- 改为启动后台清理任务
- 目标：窗口关闭不被清理耗时拖住

### R2. 全量清理 terminal / remote / watcher

- terminal：`terminal_manager.close_all_sessions()`
- remote：新增 `remote_terminal_manager.close_all_sessions()`
- watcher：新增 `watcher_manager.stop_all()`
- 三路都必须在退出链路中执行

### R3. 三路并行清理

- terminal、remote、watcher 清理并行执行
- 不再串行等待
- 目标：降低总清理时长

### R4. PTY 优雅关闭超时调整为 1.5s

- `GRACEFUL_TIMEOUT_SECS` 从 `3` 改为 `1.5`
- 兼顾响应速度与进程优雅退出
- 超时后仍需强制终止

### R5. 后台清理结束后兜底强制退出

- 后台清理完成后调用 `std::process::exit(0)`
- 防止窗口关闭后进程继续挂住
- 避免 Dock 残留进程状态

### R6. 增加退出链路日志

- 记录退出清理开始时间
- 分别记录 terminal / remote / watcher 清理完成时间
- 记录最终强制退出时间点
- 便于后续排查退出耗时

## Implementation Notes

### 1. `src-tauri/src/terminal.rs`

- 修改 `GRACEFUL_TIMEOUT_SECS = 1.5`
- `close_all_sessions()` 保留现有逻辑
- 后续由后台任务并行调度

### 2. `src-tauri/src/remote.rs`

- 新增 `close_all_sessions()`
- 遍历 `ssh_handles`
- 逐个调用 `close_session`
- 保持与本地 PTY 类似的清理语义

### 3. `src-tauri/src/watcher.rs`

- 新增 `stop_all()`
- 遍历 watchers
- 显式设置 stop_signal
- 移除 watcher handle

### 4. `src-tauri/src/app_state.rs`

- 新增 `shutdown_all_background()`
- 并行执行三路清理
- 清理结束后调用 `std::process::exit(0)`
- 增加必要错误日志，但不要因单点失败阻塞整体退出

### 5. `src-tauri/src/app.rs`

- `on_window_event(Destroyed)` 调整为：
  - 启动后台清理线程
  - 调用 `shutdown_all_background()`
- 不再在事件回调中同步等待清理结果

## Acceptance Criteria

- [ ] 点击关闭后窗口立即消失，不再出现明显卡顿
- [ ] `on_window_event(Destroyed)` 不再同步阻塞清理
- [ ] terminal / remote / watcher 三路清理在退出时都被触发
- [ ] PTY graceful timeout 从 3s 调整为 1.5s
- [ ] 退出清理在后台并行执行
- [ ] 清理结束后进程能可靠退出，不残留在 Dock
- [ ] 退出链路关键节点有日志输出
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过
- [ ] `pnpm type-check` 通过
- [ ] `pnpm lint` 通过
- [ ] 无功能回退：本地、WSL、Remote 终端关闭行为仍正常

## Verification Steps

### V1. 编译与基础检查

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm type-check
pnpm lint
```

### V2. 本地退出体感验证

- 启动 Neeko
- 打开 1 个本地项目终端
- 关闭窗口
- 预期：窗口立即关闭，无明显卡顿

### V3. 多会话退出验证

- 启动 Neeko
- 打开 2~3 个本地终端会话
- 关闭窗口
- 预期：窗口立即关闭，后台自动清理会话

### V4. Remote 退出验证

- 启动 Neeko
- 打开 1 个 SSH Remote 项目终端
- 关闭窗口
- 预期：窗口立即关闭，不出现 Remote 残留线程导致进程挂住

### V5. Watcher 退出验证

- 启动 Neeko
- 打开带 Git 项目的会话
- 关闭窗口
- 预期：watcher 轮询线程被显式停止，不继续发射事件

### V6. 日志验证

打开 `~/.neeko/neeko.log`，退出后应能看到：

- `shutdown_all_background start`
- terminal 清理完成日志
- remote 清理完成日志
- watcher 清理完成日志
- 最终 exit 日志

### V7. 超时参数验证

- 检查代码中 `GRACEFUL_TIMEOUT_SECS = 1.5`
- 若有条件，模拟慢进程退出
- 预期：超过 1.5s 后触发强制终止

## Technical Notes

- 本优化的核心是把“重清理”从 Tauri 窗口事件回调移出，避免阻塞 UI 生命周期
- 采用 `process::exit(0)` 兜底，是因为自然退出依赖所有线程/runtime 全部收尾，容易被残留线程拖住
- remote 和 watcher 原先缺少 `close_all_sessions/stop_all`，属于退出链路缺口，需要补齐
- PTY 超时从 3s 改为 1.5s 是速度与稳定性的折中，后续可根据真实反馈再调

## Out of Scope

- PTY 子进程内部信号处理改造
- Remote SSH 连接复用与重连机制重构
- Watcher 事件节流策略优化
- 前端退出确认弹窗
- 跨平台信号语义重设计
