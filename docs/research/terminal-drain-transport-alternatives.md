# 终端输出唤醒机制调研：100ms 轮询是否该换、换成什么

> 调研日期：2026-09-24
> 背景：DevTools Network 面板持续出现 `ipc://localhost/terminal_drain` 请求（每活跃 session ≈ 10 次/秒）。这是 credit-pull 协议（08-25-terminal-memory-governance）的「方案 B 去.eval 化」全局轮询器（`src/shared/utils/drainLoop.ts`）按设计发出的。本文回答：轮询方式是否不好、有没有更好的替代。
> 方法：对 Tauri 2.10.3 / wry 0.54.4 vendored 源码（`~/.cargo/registry/src/`）逐路径溯源，结合本仓库 design.md §8 的实测事故记录。
> 结论先行：**轮询不是坏方案，而是在「macOS native→JS 推送 = eval」约束下的零 eval 最简解；但存在一个改动量小、同时消灭空闲轮询与空闲延迟的更优解——long-poll（挂起式 drain 命令）**，因为 Tauri 的 ipc custom protocol 本身就是「fetch 挂起直到 async command resolve」的模型。

---

## 1. 约束推导：为什么当初从事件退到轮询

### 1.1 WKWebView 的根本不对称（一手源码）

| 方向 | 机制 | eval？ |
|---|---|---|
| JS → native | `WKScriptMessageHandler`（wry `wkwebview/mod.rs:639`：`window.webkit.messageHandlers.ipc.postMessage`） | 否 ✅ |
| native → JS（推送） | 只有 `evaluateJavaScript` 类路径 | **是** ❌ |

Tauri 的两个「推送」原语在源码里都落在 eval 分支：

- **事件 emit**：`tauri-2.10.3/src/webview/mod.rs:1937` `emit_js()` → `self.eval(emit_js_script(...))`——每次事件 = 一次 evaluateJavaScript。
- **Channel\<T\>**：`tauri-2.10.3/src/ipc/channel.rs:139-183`，三种分支**每条消息至少一次 eval**：
  - JSON < 8KB → 直接 eval；
  - Raw < 1KB → eval（`serde_json::to_string(&bytes)` 生成 JSON number 数组，~6× 膨胀）；
  - 大载荷 → eval 通知 + 前端再发一次 fetch 取二进制。

### 1.2 eval 的实测代价（本仓库事故记录）

design.md §8 / drainLoop.ts 注释记录：macOS 上高吞吐事件流（agent 流式 CLI，每秒数百次 eval）导致 WebKit 对 eval 完成值做结构化克隆 + JSON.stringify，JSC libpas mapped 内存只增不减，WebContent RSS 实测 22GB+（JS live 堆零增长，泄漏在引擎/分配器层）。这就是 `terminal-drain-{id}` 唤醒事件退役、改为 fetch 拉取的直接原因。

### 1.3 当前轮询的真实成本

- 每 session 每 100ms 一次 invoke（含队列空时）：HTTP 往返（WKURLSchemeTask）+ Rust 端请求解析 + async command spawn + Mutex lock + 空 Vec 返回——微秒级但非零；10/s × N sessions 的常驻定时器。
- **空闲首包延迟 ≤ 100ms**：这是唯一影响用户体验的项（典型表现：静置后敲键的回显）。
- 观感：Network 面板请求流「看起来像泄漏」（即本次调研的触发点）。

---

## 2. 关键事实：invoke 响应本身就是「可任意延迟」的（long-poll 可行性）

`tauri-2.10.3/src/ipc/protocol.rs` 有两条互不相同的响应路径：

1. **custom protocol 路径**（本项目实际使用的）：`manager/webview.rs:275-279` 将 `ipc` 协议以 `UriSchemeResponder` 注册（异步 responder）。流程：前端 `fetch("ipc://localhost/terminal_drain", {method:'POST'})` → 请求解析 → async command 在 tokio 上执行（**fetch 挂起等待**）→ 命令 resolve 时构建 `http::Response::new(raw_bytes)`（`protocol.rs:129-137`，`APPLICATION_OCTET_STREAM`）→ `responder.respond()` → wry macOS 对挂起的 WKURLSchemeTask 补发 `didReceiveResponse / didReceiveData / didFinish`（`wry url_scheme_handler.rs:257-291`，一次性整响应、非分块流）→ 前端 `response.arrayBuffer()` 得到二进制。
   - **JS 侧证据**：`tauri/scripts/ipc-protocol.js` —— `invoke` 即 fetch，响应体直接按 content-type 反序列化；只有 fetch 失败（CSP 等）才降级 postMessage。
2. **postMessage 降级路径**（`message_handler()`，仅在 custom protocol 被封禁时启用）：结果经 `responder_eval`（eval）或 Channel 投递——`protocol.rs:388-420`。此前误读的「macOS Raw 响应走 eval」属于这条降级路径，与本项目无关。

推论：**「async command 迟迟不 resolve、fetch 一直挂着」是 Tauri 全部 async command 的既有行为**（任何慢命令都这样）。让 drain 命令「无数据时挂起、有数据立即返回」不需要注册任何新协议，只需要命令语义变化。

---

## 3. 候选方案逐一评估

### 3.1 现状轮询 + 增量优化（保守项）

- **A1 input 触发即拉**：发送 `terminal_input` 的同时立即 fire 一次 drain——打字回显延迟从 ≤100ms 降到一个 RTT（PTY 回显语义下 input 后必有输出）。改动：`TerminalViewBase.tsx` 的 input controller 一行级。
- **A2 自适应退避**：连续 k 次空拉后 tick 间隔 ×2（上限如 500ms），拉到数据重置。空闲 IPC 往返降 5-20×；配合 A1，键盘回显不受退避影响。
- 评价：改动最小、零风险；但轮询语义仍在（退避后观感改善），空闲延迟上限仍存在。

### 3.2 ★ long-poll（挂起式 drain）—— 推荐方案

设计草图（后端，改动集中在 drain 协议层）：

```rust
// SessionDrain 增加（drain.rs）：
notify: tokio::sync::Notify   // push 成功/竞态补发 → notify_one；close() → notify_waiters

// push / take_and_rearm 的 wake 闭包从「空操作」换成 notify（manager.rs:76、remote.rs:334、services.rs 泵侧同步接入）

// 新命令（terminal/commands.rs）：
#[tauri::command]
pub async fn terminal_drain_wait(
    session_id: String, timeout_ms: u64, state: State<'_, AppStateWrapper>,
) -> Result<tauri::ipc::Response, AppError> {
    state.terminal_drain_wait(&session_id, Duration::from_millis(timeout_ms))
    // 语义：取积压；非空立即返回；空则 await Notify（或 timeout）后重试一次再返回；
    // closed → 立即返回空 + closed 标志（前端据此停止重挂）
}
```

前端：`drainLoop.ts` 的轮询器替换为「每 session 一条 while 循环的挂起 fetch」（`createPollingDrainScheduler` → `createLongPollScheduler`）；`runDrainLoop` / `createDrainScheduler` 的 pendingWake 闩锁、maybePending 续拉、门闸语义**原样保留**——long-poll 的每次返回天然等价于一次 wake。

成本对比（每 session）：

| | 空闲 IPC 往返 | 空闲首包延迟 | eval |
|---|---|---|---|
| 现状轮询 | 10 /s | ≤100ms | 0 |
| long-poll | ≈0.03-0.05 /s（自兜底超时重挂） | ≈16ms（泵 flush interval）+ RTT | 0 |

需 spike 验证的三个风险点（预计半天）：

1. **WKURLSchemeTask 隐性超时**：WebKit 对自定义 scheme task 是否有默认超时未见文档定论 → 设计上自兜底 20-30s 超时重挂已规避；实测确认挂起 30s 无异常即可。
2. **页面重载 / webview 销毁时挂起 fetch 的行为**：wry 有 `check_task_is_valid` 防 segfault（`url_scheme_handler.rs:157-171`）；前端需容忍 fetch abort 并在 session-ready 后重挂。本项目 detach/reattach 保活架构下需专项测试。
3. **Windows (WebView2) / Linux (WebKitGTK)**：同走 `UriSchemeResponder` 模型（所有 async command 同路径，理论无平台差异），但 Windows GUI 下长挂响应需各跑一次冒烟。

### 3.3 Tauri Channel\<T\> —— 一手源码排除

每条消息 ≥1 次 eval（§1.1）；小二进制分支还是 JSON number 数组形式（最差形态）。继承 eval 内存问题，高吞吐下比现状更差。Tauri 源码自己的注释（`channel.rs:36-38`：小载荷 eval 比 fetch 快 30%~2×）只比较**速度**，与本项目要规避的**引擎层内存增长**正交，不构成反证。

### 3.4 合流唤醒事件（事件推送 + 轮询兜底）—— 不推荐

- 事件 = eval；即使后端节流到 ≤10/s，长会话累积 eval 次数仍是 10⁵/天量级，内存增速放缓但不归零。
- 重新引入「唤醒丢失」协议复杂度——design.md §8 的全 tab 冻结事故根因就是三处唤醒吞噬点；为省 10 次/s 的空 fetch 重新背上这类风险，得不偿失。
- 唯一翻案条件：实测证明 eval 内存代价正比于**字节数**而非**次数**（固定微载荷 hint 事件可能无害）。但即便成立，收益也不超过 3.2。

### 3.5 本地 WebSocket / SSE 服务器（绕开 Tauri IPC）—— 不推荐（YAGNI）

真推送、零 eval、支持流式分块（优于 wry 一次性整响应）。但相对 3.2 新增全部这些成本：TCP 端口分配 + 连接 token 认证（防本机其他进程连入）+ CSP `connect-src` 调整 + 端口发现握手 + 服务生命周期与断线重连。换来的仅是「空闲零 fetch」（3.2 已是 0.03/s）与 loopback RTT 的微小差距。

### 3.6 其他否决项

- `WKWebView callAsyncJavaScript` / MessagePort 桥：native→JS 仍是 eval 类路径，同引擎机制。
- SharedArrayBuffer / 共享内存：WebView 与 native 间无此桥。
- 把 PTY 泵整体搬到 localhost ws 服务（VS Code 式）：即 3.5，过度工程。

---

## 4. 决策矩阵

| 方案 | eval/秒（空闲） | IPC 往返/秒（空闲） | 空闲首包延迟 | 改动量 | 复杂度 / 风险 |
|---|---|---|---|---|---|
| 现状轮询 | 0 | 10×N | ≤100ms | — | 低 |
| 3.1 轮询 + 退避 + input 触发 | 0 | 0.5~2×N | 键盘≈RTT；其余≤上限 | 小 | 低 |
| **3.2 long-poll** | 0 | ≈0.03×N | ≈16ms + RTT | 中 | 中（3 个 spike 点） |
| 3.3 Channel | ≥消息数 | — | 低 | 中 | 高（eval 继承） |
| 3.4 混合事件 | ≥节流率 | 0 | ≈0 | 大 | 高（唤醒丢失事故史） |
| 3.5 WS / SSE | 0 | ≈0 | ≈0 | 大 | 高（安全面 + 生命周期） |

## 5. 建议路线

1. **立即**（一小时级）：3.1-A1 input 触发即拉——直接改善打字回显，与任何后续方案正交。
2. **短期**（半天 spike + 一天实现）：验证 3.2 的三个风险点；通过则迁移 long-poll，轮询器保留为降级路径（环境变量开关即可，回退成本≈0）。注意沿用项目红线：事件名常量化不回归、command 层保持极薄、TDD 补 `SessionDrain` notify 语义与 closed 竞态测试。
3. **明确不做**：3.3（一手源码排除）、3.4（事故史 + 复杂度）、3.5（YAGNI）。

## 附录：一手源码引用

| 论断 | 位置 |
|---|---|
| 事件 emit = eval | `tauri-2.10.3/src/webview/mod.rs:1937`（`emit_js` → `self.eval`） |
| Channel 每消息 ≥1 eval；小 Raw 以 JSON 数组 eval | `tauri-2.10.3/src/ipc/channel.rs:139-183` |
| Tauri 自评 eval/fetch 速度取舍（仅速度维度） | `tauri-2.10.3/src/ipc/channel.rs:36-38` |
| invoke = fetch，响应体按 content-type 反序列化，失败降级 postMessage | `tauri-2.10.3/scripts/ipc-protocol.js` |
| ipc 协议以 UriSchemeResponder（异步）注册 | `tauri-2.10.3/src/manager/webview.rs:275-279` |
| Raw 响应体 = `http::Response::new(bytes)`，经 responder 延迟回包 | `tauri-2.10.3/src/ipc/protocol.rs:129-137`（`get()` 路径）；eval 分支属 `message_handler()` 降级路径（:388-420） |
| wry macOS 对挂起 task 的延迟回包与防 segfault 校验 | `wry-0.54.4/src/wkwebview/class/url_scheme_handler.rs:157-171, 257-291` |
| JS→native = WKScriptMessageHandler（零 eval） | `wry-0.54.4/src/wkwebview/mod.rs:639` |
| 当前 wake 闭包为空操作（long-poll 接入点） | `src-tauri/src/terminal/manager.rs:76`、`src-tauri/src/terminal/remote.rs:334` |
| eval 内存事故与轮询器设计动机 | `.trellis/tasks/archive/2026-08/08-25-terminal-memory-governance/design.md` §8、`src/shared/utils/drainLoop.ts` 模块注释 |
