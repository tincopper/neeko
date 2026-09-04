# Design — 终端输出 long-poll 传输改造

> 调研依据：`docs/research/terminal-drain-transport-alternatives.md`（含全部一手源码引用）。
> 原协议：`.trellis/tasks/archive/2026-08/08-25-terminal-memory-governance/design.md`。

## 0. 核心洞察

Tauri ipc custom protocol 的 async command 响应经 `UriSchemeResponder` 投递，fetch 挂起到命令 resolve 的任意时刻（`tauri-2.10.3/src/manager/webview.rs:275`、`src/ipc/protocol.rs:129-137`）。因此「唤醒」不需要事件（eval）也不需要轮询——把 drain 命令本身变成挂起点即可：无数据时 await，push 时被唤醒。

## 1. 边界与数据流（改造后）

```
PTY/SSH ──> OutputPump（16ms 合流，不变）
                │ push（满载停读，不变）
                ▼
        SessionDrain[buffer + Notify]      ← 新增 Notify permit
                ▲ notify_one（push 后，permit 合并语义天然防唤醒风暴）
                │
前端 per-session 长循环：
   wait fetch(terminal_drain_wait, 25s 自兜底)   ← fetch 挂起 = 零空转
        │ 数据到达 → 立即返回字节
        ▼
   write(chunk) → onWake → runDrainLoop（既有：拉到空/门闸早退）
        │
   └──< 续挂（循环）
```

关键点：**long-poll 返回的数据块直接 write，不经 runDrainLoop 的首次 pull**（wait 已消费缓冲）；`onWake` 仅负责补拉竞态窗口内新到达的数据。既有调度器（`createDrainScheduler` 的 pendingWake/maybePending）原样复用。

## 2. Rust 端

### 2.1 `common/terminal/drain.rs`

`SessionDrain` 新增字段 `notify: tokio::sync::Notify`（tokio 已是 full features）。

新增 API（**不改动**既有 `push` / `take_and_rearm` 签名与行为——轮询降级路径继续可用，既有同步测试不动）：

```rust
/// 生产侧唤醒钩子：由 push 调用方在 push 成功/被拒后调用。
/// permit 合并：无 waiter 时存一个 permit，多次调用折叠为一次唤醒。
pub(crate) fn notify_one(&self);

/// 消费侧挂起等待（仅 async 上下文调用）。
/// 返回 Ok(bytes)：非空积压（含等待后被唤醒）；
/// 返回 Ok(vec![])：idle 超时（前端续挂）；
/// 返回 None 语义由 manager 层转 NotFound：drain 不存在或 closed。
pub(crate) async fn wait_drain(&self, idle_timeout: Duration) -> Option<Vec<u8>>;

/// close() 追加：notify_waiters()（best-effort 唤醒挂起方；
/// 未注册 waiter 的竞态由下一轮 is_closed 检查兜底）。
```

`wait_drain` 循环（丢失唤醒不可能性的论证）：

```rust
loop {
    let data = { lock(buffer).take_all() };
    if !data.is_empty() { return Some(data); }
    if self.is_closed() { return None; }
    match tokio::time::timeout(idle_timeout, self.notify.notified()).await {
        Ok(_) => continue,          // permit 或真唤醒 → 重查缓冲
        Err(_elapsed) => return Some(Vec::new()),   // 超时 → 空响应
    }
}
```

丢失唤醒闭合：`Notify::notify_one` 在无 waiter 时**存储 permit**，下一次 `notified()` 立即完成——「take 与 await 注册之间 producer 插入数据」的竞态窗口由 permit 语义覆盖（强于旧 `wake_in_flight` 事件合流，后者有吞噬点史，design.md §8）。

### 2.2 `terminal/commands.rs` + `app_state.rs` + `lib.rs`

```rust
#[tauri::command]
pub async fn terminal_drain_wait(
    session_id: String, timeout_ms: u64, state: State<'_, AppStateWrapper>,
) -> Result<tauri::ipc::Response, AppError>
```

- `app_state.rs` 新增 `pub async fn terminal_drain_wait(&self, session_id: &str, timeout_ms: u64)`：按 `session_owner` 分发到 `terminal_manager` / `remote_terminal_manager` 的 `wait_drain`（镜像既有 `terminal_drain` 结构，Command 极薄）。
- `timeout_ms` 后端钳制：`clamp(1_000, 30_000)`，前端传 25_000。
- drain 不存在 **或 closed** → `AppError::NotFound`（closed 即将 teardown，前端应停止；复用错误通道，不扩协议）。
- 命令注册：`lib.rs` `neeko_invoke_handler!` terminal 分组追加一行。

### 2.3 push 调用方接入 notify（两处 + 泵）

- `terminal/services.rs:324`：`session_drain.push(data, || {})` → `session_drain.push(data, || session_drain.notify_one())`
- `terminal/remote.rs:240`：同上。
- `terminal/manager.rs:76` 与 `remote.rs` 的 `take_drain`（轮询路径）**保持空闭包**——轮询语义下 tick 即唤醒。

孤儿挂起任务：fetch abort / webview 销毁后，已 spawn 的命令 future 可能继续等到超时——无锁、无副作用，respond 时 wry `check_task_is_valid` 静默拒绝。无害，不处理。

### 2.4 并发约束

- 每 session 至多一个挂起 waiter（前端保证）；若重建竞态出现双 waiter，`notify_one` 唤醒其一，另一个走超时路径自愈。无死锁面（Notify 非互斥）。
- 不跨 await 持锁：`wait_drain` 内 Mutex 仅在 take_all 瞬时持有。

## 3. 前端

### 3.1 `shared/utils/drainLoop.ts`

- 保留全部既有导出（`runDrainLoop` / `createDrainScheduler` / `createPollingDrainScheduler` / 常量）——轮询降级路径与既有测试不动。
- 新增：

```ts
export const DRAIN_WAIT_TIMEOUT_MS = 25_000;

interface DrainSchedulerDeps 扩展可选: drainWait?: (sid, ms) => Promise<ArrayBuffer>

export function createLongPollScheduler(deps: DrainSchedulerDeps): DrainScheduler & { dispose(): void }
```

循环骨架（复用既有调度器做拉取侧协议）：

```ts
const inner = createDrainScheduler(deps);   // onWake/onWriteDigested/pendingWake 语义复用
let disposed = false;
const abort = new AbortController();
void (async () => {
  while (!disposed) {
    try {
      const chunk = await deps.drainWait!(deps.sessionId, DRAIN_WAIT_TIMEOUT_MS, abort.signal);
      if (disposed) break;
      if (chunk.byteLength > 0) deps.write(chunk);
      inner.onWake();               // 补拉竞态数据；含 pendingWake 闩锁
    } catch (e) {
      if (disposed) break;
      // NotFound = 会话已关闭/移除 → 终止循环（debug 日志）
      break;
    }
  }
})();
return { onWake, onWriteDigested, dispose() { disposed = true; abort.abort(); } };
```

- **背压门闸交互**：`runDrainLoop` 门闸早退（exhausted=false）时，`maybePending` 置位，write 消化回调经 `onWriteDigested` 续拉——既有机制，long-poll 循环不感知（续挂照常，后端有界缓冲承接）。循环不空转：挂起 fetch 本身就是阻塞点。
- **NotFound 终止**：await 抛错且未 disposed → break。会话正常关闭由既有 `terminal-closed-{id}` 监听先 dispose，NotFound 是兜底。
- AbortController 传入 api 层 → `invoke` 不原生支持 signal，降级为：dispose 后循环以 `disposed` 标志丢弃迟到结果（fetch 自然超时上限 25s）；不留孤儿 interval（轮询器的 setInterval 问题不存在）。
- 降级开关：`const USE_POLL_FALLBACK = import.meta.env.VITE_TERMINAL_DRAIN_POLL === '1'`，导出统一入口 `createDrainTransportScheduler(deps)`：开关开 → `createPollingDrainScheduler`，否则 → `createLongPollScheduler`。

### 3.2 消费方切换（3 处，各改 1 行构造 + api 注入）

| 文件 | 变更 |
|---|---|
| `features/terminal/api/terminalApi.ts` | 新增 `drainTerminalWait(sessionId, timeoutMs): Promise<ArrayBuffer>` |
| `features/task/api/taskApi.ts` | 镜像新增（保持本地镜像约定） |
| `features/terminal/components/TerminalViewBase.tsx:393` | `createPollingDrainScheduler` → `createDrainTransportScheduler`，deps 注入 `drainWait: drainTerminalWait` |
| `features/terminal/components/terminalFactory.ts:134` | 同上 |
| `features/task/taskRunner.ts:80` | 同上 |

dispose 链路逐一核对（AC4）：TerminalViewBase `entry.unlisten` + `terminal-closed` 监听；terminalFactory `cache.unlistenOutput`；taskRunner `dispose()`。均已在既有代码收敛，无需新改动，仅需验证 dispose 传导到 `disposed` 标志。

## 4. 兼容与回滚

- 协议面：新增一个命令，无事件、无字段变更；`terminal_drain` 保留（降级路径使用）。
- 回滚：`VITE_TERMINAL_DRAIN_POLL=1` 运行时回退；或 git revert（前后端同 revert 粒度）。
- 平台：macOS/Windows/Linux 同走 async command + UriSchemeResponder 路径；Windows/Linux 各跑一次冒烟（spike 风险点 3）。

## 5. Spike 验证点（实现前先证）

1. macOS：挂起 fetch 25s 内无 WebKit 侧异常断开（Network 面板观察 pending 状态 + 命令按期 resolve）。
2. macOS：终端关闭 → terminal-closed 事件 → dispose → abort → 无残留挂起请求。
3. Windows/Linux：长挂响应正常返回、关闭会话无悬挂（低风险：与慢 async command 同路径，预期直接通过）。

## 6. 测试策略（TDD）

| 层 | 用例 |
|---|---|
| Rust `drain.rs` `#[tokio::test]` | ①有数据立即返回；②空→push 唤醒取到字节；③push 先于 wait（permit 竞态）不丢唤醒；④closed→None；⑤超时→空；⑥close 唤醒挂起方 |
| Rust 编译门 | 命令注册、双 owner 分发（`cargo check`） |
| vitest `drainLoop.test.ts` 扩展 | ①数据块 write+续挂；②NotFound 终止；③dispose 终止且迟到结果丢弃；④门闸早退 → digest 续拉（复用既有用例模式）；⑤降级开关选中轮询器 |
| 手动冒烟 | AC7 |

## 7. 权衡记录

1. **closed → NotFound 复用错误通道**：不扩二进制协议（前缀字节/header 方案均需动响应解析），closed 本就伴随 teardown，语义等价；代价是前端以异常控制流终止循环（可接受，与既有 catch 静默豁免一致）。
2. **abort 不进 invoke**：`@tauri-apps/api` invoke 无 signal 支持；`disposed` 标志 + 25s 上限足够（后端孤儿任务无害）。引入手写 fetch 封装属过度设计。
3. **保留轮询器实现**：非死代码——运行时降级开关使用；不违反 YAGNI（协议级切换的逃生门）。
