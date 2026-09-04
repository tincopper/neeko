# 终端输出 long-poll 传输改造（去轮询化）

## Goal

将终端输出 credit-pull 协议的触发源从「100ms 全局共享轮询器」迁移为「long-poll 挂起式 drain 命令」，在保持零 eval、零丢字节的前提下，消除空闲期 IPC 空转请求（每 session ≈10 次/秒）并将空闲首包延迟从 ≤100ms 降至泵 flush interval（≈16ms）+ RTT。

依据：`docs/research/terminal-drain-transport-alternatives.md`（一手源码调研，结论 §5 建议路线）。

## Background

- 现状：前端全局轮询器（`src/shared/utils/drainLoop.ts` `createPollingDrainScheduler`，100ms tick）对每个活跃 session 周期性 invoke `terminal_drain`，队列空也发（空 invoke）。DevTools Network 持续出现 `ipc://localhost/terminal_drain`。
- 约束：macOS native→JS 推送 = eval（内存事故根因，design.md §8），因此唤醒通道必须保持 fetch 拉取（零 eval）。Tauri ipc custom protocol 的 async command 响应可任意延迟（`UriSchemeResponder` 模型），long-poll 无需新增协议面。

## Requirements

1. **协议语义不变**：credit-pull 核心（有界 SessionDrain、背压门闸 MAX_IN_FLIGHT_WRITES、drain-to-empty、字节永不丢失）全部保留；`createDrainScheduler` 的 pendingWake 闩锁 / maybePending 续拉语义保留。
2. **新增挂起式命令**：Rust 端新增 `terminal_drain_wait(session_id, timeout_ms)` —— 有数据立即返回字节；无数据挂起（tokio Notify），数据到达或超时返回；会话已关闭/不存在 → NotFound。
3. **前端传输切换**：三个消费方（TerminalViewBase 主终端、terminalFactory 编辑器-tab 终端、taskRunner 任务控制台）改用 long-poll 调度器；保留轮询器实现作为降级路径（环境变量开关），可一键回退。
4. **生命周期正确**：dispose（含 terminal-closed 事件、缓存销毁、HMR）能及时终止本 session 的挂起 fetch 与循环；后端孤儿挂起任务（fetch abort 后仍在等超时的命令）无害。
5. **平台一致**：macOS / Windows / Linux 三端行为一致（同一 async command 路径）。
6. **可观测**：NotFound 终止路径有 debug 级日志，便于排查 dispose 泄漏。

## Out of Scope

- 不新增 Tauri 事件、不引入本地 WebSocket/SSE 服务器、不使用 Channel\<T\>（调研已排除）。
- 不做「input 触发即拉」优化（调研 3.1-A1，独立小项，另行处理）。
- 不新增设置界面项；降级开关仅环境变量。

## Acceptance Criteria

- **AC1** 后端：`SessionDrain` 挂起等待有完整单元测试覆盖 —— ①有数据立即返回；②空队列挂起、push 后被唤醒并取到字节（含 push 先于 wait 注册的竞态，permit 语义）；③closed 返回 NotFound 语义；④超时返回空。
- **AC2** 后端：`terminal_drain_wait` 命令注册进 `neeko_invoke_handler!`，Pty/Ssh 双 owner 分发正确（复用 `session_owner` 路由）。
- **AC3** 前端：long-poll 调度器单测覆盖 —— 数据块写入并续挂、NotFound/异常终止循环、dispose 即时终止（AbortController）、背压门闸早退后经 digest 回调续拉、timeout 空转不堆积。
- **AC4** 三处消费方（TerminalViewBase / terminalFactory / taskRunner）全部切换且 `dispose` 链路（entry.unlisten、terminal-closed 监听、taskRunner dispose）逐一核对，无轮询器残留注册。
- **AC5** 环境变量开关（如 `VITE_TERMINAL_DRAIN_POLL=1`）能整体回退到轮询行为，call site 一行不改。
- **AC6** 质量门全绿：`pnpm lint`、`pnpm type-check`、`pnpm test:run`、`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy`。
- **AC7** 手动冒烟（macOS）：本地终端打字回显正常、`pnpm tauri dev` 下 Network 面板空闲期 `terminal_drain` 请求从 ≈10/s 降为 ≈0.04/s、关闭终端后该 session 请求完全停止。
