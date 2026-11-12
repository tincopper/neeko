# 设计：LSP IPC 边界与契约执行侧

## 0. 边界

`src-tauri/src/lsp/{commands.rs,types.rs,session/{instance.rs,notify.rs}}` +
`src/features/lsp/transport/tauriLspTransport.ts` + 新增 `src/shared/__tests__/lspEventConstant.test.ts`。
不动诊断载荷、不动 store 分片、不动 `LspSessionInfo` 的字段命名。

## 1. 五项与判据

### 1.1 IPC 响应字节预算（R1，红线 4）

现状：`lsp_request` 直接返回 `Value`，`lsp_transport` 直接把 `serde_json::to_string` 的字符串
返回 —— 两者都没有上界。`textDocument/references` 在大仓返回上万条 `Location`（≈1.2MB+）、
`documentSymbol`（生成代码）、带 `documentation` 的 completion 都可能单次 >2MB。

```rust
// lsp/types.rs
/// 单次 IPC 响应的字节上限（红线 4）。与 `DIFF_PAYLOAD_MAX_BYTES` 同口径：2 MiB。
pub const LSP_RESPONSE_MAX_BYTES: usize = 2 * 1024 * 1024;
```

两个命令各在返回前量一次：

- `lsp_transport`：**已经**序列化成 `String` ⇒ 直接 `s.len()`，零额外成本。
- `lsp_request`：返回 `Value`，Tauri 还会再序列化一次。为了判定预算必须自己量一次
  （`serde_json::to_vec(&value)?.len()`）。代价：大响应多一次序列化（2MB 量级几十 ms），
  换来的是「不会把 50MB 丢进 IPC」。**只在超限时才多这个成本？** 不行 —— 不知道长度就无法
  判定。接受该成本，并在注释里写明。

超限行为：`AppError::Lsp(format!("LSP response for {method} is {n} bytes, over the {MAX} budget; ..."))`
—— 文案必须能被用户/AI 直接读懂「发生了什么、该怎么收窄（references 加范围 / 关掉 documentSymbol）」。
**不截断**：截断的 JSON 会让前端解析出半个结果，比失败更难诊断。

### 1.2 删 `relatedInformation` 假声明（R2，红线 14）

`instance.rs::build_client_capabilities` 里 `publishDiagnostics.relatedInformation: true`
全仓零消费（`rg relatedInformation src/` 零命中）。声明它 = 让服务器为每条诊断附带
我们永不显示的关联位置（纯 IPC/内存开销）。删除，并在 spec 的「能力声明」条目里记一句。

### 1.3 `indexing` 经 lifecycle 单写点（R3）

`notify.rs` 的 `$/progress begin` 直接 `transport.push_session_event(..., "indexing", ...)`，
绕过 `publish_status`。后果：关闭后迟到的 `begin` 仍会推 `indexing`，chip 被复活；
并且 `snapshot()`（读 lifecycle）与事件流不同源。

改法：走 `LspSession::publish`/`publish_status` 同一入口（`LspSessionStatus::Indexing`），
内部已处理终态门（终态后不再发布）。判据：`indexing_event_is_gated_by_terminal_phase`。

### 1.4 事件常量跨栈断言（R4，红线 5 执行侧）

现有 `types.rs::event_names_match_frontend_mirror` 只比对**同文件内**的字面量，不改前端也能绿。
新增 `src/shared/__tests__/lspEventConstant.test.ts`，形态照 `sessionsEventConstant.test.ts`：
读 `src-tauri/src/lsp/types.rs`，用正则抠出每个 `pub const LSP_*_EVENT*` 的声明值，
与 `src/shared/events.ts` 的常量逐字比较；声明缺失/出现多次直接红。

覆盖：`LSP_DIAG_EVENT_PREFIX` / `LSP_PROGRESS_EVENT_PREFIX` / `LSP_SESSION_EVENT_PREFIX` /
`LSP_APPLY_EDIT_EVENT_PREFIX` / `LSP_INSTALL_PROGRESS_EVENT` / `LSP_PROFILE_EVENT`。

### 1.5 监听器生命周期（R5）

`setup()` 里三个 `listen(...).then(unlisten => this.unlistenX = unlisten)`：`destroy()` 只注销
「已赋值」的句柄。HMR dispose / 测试 reset / 将来调小 idle 阈值时 `destroy()` 可能先于
`listen()` resolve ⇒ 三个监听器永久泄漏（且没有任何代码再持有它们）。

改法：`.then(u => { if (this.destroyed) { safeUnlisten(u)(); return; } this.unlistenX = u; })`
三处同修。`destroyed` 标志已存在（`destroy()` 里置位）。

顺带删除**死**的 `$/progress` 转发：`@codemirror/lsp-client` dist 内无 `$/progress` 消费点
（`rg '\$/progress' dist/index.js` 零命中），该监听器只是每个 transport 多订阅一次事件。
Rust 侧的 `lsp-progress-*` 事件仍被 `lspStore` 的 busy 投影消费，**不删**。

## 2. 失败与边界矩阵

| 场景 | 期望 |
| --- | --- |
| 响应 1.9MB | 原样返回 |
| 响应 2.1MB | `AppError::Lsp`，文案含字节数 + method + 收窄建议；**不截断** |
| `lsp_transport` 返回空字符串（通知） | 不量（0 字节，直接过） |
| 会话已 `CLOSED` 后收到 `$/progress begin` | 不推 `indexing`（lifecycle 终态门丢弃） |
| `destroy()` 早于 `listen()` resolve | 立即注销该监听器，不赋值 |
| 前端改了 `LSP_PROGRESS_EVENT_PREFIX` | 新跨栈断言红（不依赖 Rust 侧同步改） |

## 3. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 超预算直接失败而非截断/分页 | 大 `references` 查询变成错误 | 截断的 JSON 前端无法解释；分页需要新命令 + 前端改造（独立任务） |
| `lsp_request` 多序列化一次 | 大响应多几十 ms | 无法在不量的前提下判定长度；2MB 是上限，不是常态 |
| 删 `$/progress` 转发 | 将来 lsp-client 支持 progress 时要加回来 | 现在是零消费的死订阅；加回来是 5 行 |
| 删 capability 声明而不是实现渲染 | 丢失「相关位置」能力（我们从未显示过） | 红线 14：声明必须有消费点；要恢复必须先有渲染 |

## 4. 兼容与回滚

- 无 wire 字段改名；新增一个错误分支（超限）。
- 回滚 = revert 单个 commit：预算消失（回到无界）、`relatedInformation` 恢复声明、
  indexing 回到直推。
- 风险：某些用户依赖超大 `references` 结果 → 现在会看到明确错误而不是卡死；
  这是有意的取舍（红线 4）。
