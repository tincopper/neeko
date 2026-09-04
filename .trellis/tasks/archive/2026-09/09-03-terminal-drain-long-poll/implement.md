# Implement — 终端输出 long-poll 传输改造

> 严格 TDD：每步先测后码。验证命令见各步；最终回归门见 §8。
> 回滚点：每步独立提交可 revert；运行时降级开关（步骤 6）上线后兜底。

## 步骤清单

### 1. Rust：SessionDrain 挂起等待（Red → Green）

- [x] 1.1 **Red**：`src-tauri/src/common/terminal/drain.rs` 测试模块新增 `#[tokio::test]` 用例：
  - `wait_drain_returns_buffered_data_immediately`
  - `wait_drain_parks_until_push_then_returns_bytes`（短超时 50ms，push 侧独立 task）
  - `wait_drain_no_lost_wakeup_when_push_precedes_park`（push → 再 wait，permit 立即送达）
  - `wait_drain_returns_none_when_closed`
  - `wait_drain_returns_empty_on_idle_timeout`
  - `close_wakes_parked_waiter`
  - 确认编译失败（`wait_drain`/`notify_one` 不存在）
- [x] 1.2 **Green**：`SessionDrain` 增加 `notify: tokio::sync::Notify` 字段 + `notify_one()` + `wait_drain(idle_timeout)`（见 design.md §2.1 循环骨架）+ `close()` 追加 `notify_waiters()`。
- [x] 1.3 `cargo test --manifest-path src-tauri/Cargo.toml drain` 全绿；既有同步测试不动不改。

### 2. Rust：push 调用方接入 notify

- [x] 2.1 `src-tauri/src/terminal/services.rs:324` 泵 flush 闭包：`|| {}` → `|| session_drain.notify_one()`。
- [x] 2.2 `src-tauri/src/terminal/remote.rs:240` SSH push：同上。
- [x] 2.3 轮询路径（`manager.rs` / `remote.rs` 的 `take_drain`）保持空闭包不动，注释补一行说明（long-poll 路径经 Notify，轮询路径 tick 即唤醒）。
- [x] 2.4 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test`（全量）绿。

### 3. Rust：terminal_drain_wait 命令（Red → Green）

- [x] 3.1 **Red**：`src-tauri/tests/unit/`（或 commands 就近测试模块）新增 manager 级用例：wait_drain 经 `TerminalManager`/`RemoteTerminalManager` 分发 —— 有数据返回字节；不存在/已关闭返回 NotFound。确认失败。
- [x] 3.2 **Green**：
  - `terminal/manager.rs` 新增 `pub(crate) async fn wait_drain(&self, session_id, timeout) -> Option<Vec<u8>>`（镜像 `take_drain` 查表结构，调 `drain.wait_drain().await`；closed/missing → None）。
  - `terminal/remote.rs` 同样新增。
  - `app_state.rs` 新增 `pub async fn terminal_drain_wait(&self, session_id: &str, timeout_ms: u64) -> Result<tauri::ipc::Response, AppError>`：`timeout_ms.clamp(1_000, 30_000)`，按 `session_owner` 分发，None → `AppError::NotFound`。
  - `terminal/commands.rs` 新增 `#[tauri::command] pub async fn terminal_drain_wait(...)`（极薄）。
  - `lib.rs` `neeko_invoke_handler!` terminal 分组追加 `$crate::terminal::commands::terminal_drain_wait,`。
- [x] 3.3 `cargo test` + `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 绿。

### 4. 前端：drainWait api + long-poll 调度器（Red → Green）

- [x] 4.1 **Red**：`src/shared/utils/__tests__/drainLoop.test.ts` 扩展（mock `drainWait`）：
  - `long poll writes chunk then re-arms`（首个 wait 返回字节 → write 被调 → 再次 wait）
  - `long poll stops on NotFound error`
  - `dispose stops loop and drops late results`
  - `gate backpressure resumes via onWriteDigested`（沿用既有用例模式改写）
  - `transport selector honors VITE_TERMINAL_DRAIN_POLL fallback`
  - 确认失败（导出不存在）。
- [x] 4.2 **Green**：
  - `src/features/terminal/api/terminalApi.ts`：`export function drainTerminalWait(sessionId, timeoutMs): Promise<ArrayBuffer>`。
  - `src/features/task/api/taskApi.ts`：镜像 `drainTaskProcessOutputWait`。
  - `src/shared/utils/drainLoop.ts`：新增 `DRAIN_WAIT_TIMEOUT_MS`、`createLongPollScheduler`、`createDrainTransportScheduler`（开关逻辑，design.md §3.1）。
- [x] 4.3 `pnpm test:run -- drainLoop` 绿；`pnpm type-check` 绿。

### 5. 前端：三处消费方切换

- [x] 5.1 `TerminalViewBase.tsx:393`：构造改 `createDrainTransportScheduler`，deps 注入 `drainWait: drainTerminalWait`。
- [x] 5.2 `terminalFactory.ts:134`：同上（drain 仍用 `drainTerminal`，wait 用新 api）。
- [x] 5.3 `taskRunner.ts:80`：同上。
- [x] 5.4 核对 dispose 链路（AC4）：三处 dispose 均调用新调度器 `dispose()`；grep 确认无 `createPollingDrainScheduler` 残留调用（drainLoop.ts 内部降级分支除外）。
- [x] 5.5 `pnpm lint:fe` + `pnpm type-check` + `pnpm test:run` 绿。

### 6. 降级开关验证

- [~] 6.1 `VITE_TERMINAL_DRAIN_POLL=1 pnpm dev` 启动，确认行为回到轮询（Network 10/s）。
- [~] 6.2 默认模式确认 long-poll 生效。

### 7. Spike / 冒烟（design.md §5）

- [~] 7.1 macOS `pnpm tauri dev`：空闲期 Network `terminal_drain` 请求 ≈0.04/s；打字回显正常；agent 流式输出正常。
- [ ] 7.2 关闭终端：terminal-closed → dispose → 该 session 请求完全停止，无悬挂 pending。
- [ ] 7.3 （有条件）Windows/Linux 冒烟各一次。

### 8. 最终回归门

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## Review Gates

- 步骤 3 后：检查 `neeko_invoke_handler!` 注册与 Command 极薄约定（红线 6）。
- 步骤 5 后：grep 无残留轮询构造；事件名无常量外硬编码（红线 5，本次无新事件）。
- 全程：不改动 `take_and_rearm`/`runDrainLoop` 既有语义（字节永不丢失）。
