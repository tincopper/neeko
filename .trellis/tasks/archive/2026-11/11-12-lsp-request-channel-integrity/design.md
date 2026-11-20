# 设计：请求通道健全性

## 0. 边界

只动 `src-tauri/src/lsp/`：`session/request.rs`（失败分类 / id 分配 / 超时）、
`session/instance.rs`（init id + 终态单写者）、`session_store.rs`（restart streak）、
`manager.rs`（错误分类消费点 + 重启路径真正重建）。协议与前端契约不变。

## 1. 现状缺陷（证据见 `../11-12-lsp-graceful-shutdown/research/audit-channel.md` D2/D4/D5/D6/D13）

```
do_send_request()  ── 任何 error response → bail!("LSP error (code)") ─┐
                                                                      ▼
manager::send_request_with_policy ─────────────────────────────► "Will restart"
   │  restart path: restart_count += 1
   └─ get_or_create_session(...)  ← 会话还活着 ⇒ 快路径**复用同一个坏会话**
```

三个独立缺陷叠在一起：

1. **分类错误**：`-32602`（文档未打开）/ `ContentModified`（编辑中）都是**请求级**失败，
   服务器完全健康，却被当成会话故障。
2. **重启是空操作**：活会话被 `get_or_create_session` 快路径复用 ⇒ 计数器涨、进程不换。
3. **计数不清零**：`increment_restart` 只增不减 ⇒ 5 次普通错误后该 `project:lang`
   永久 `Max restart count exceeded`，chip 仍显 Running、前端无重试入口。

另外三条（同一通道）：三套 id 生成器共用一个 `pending` 表且 `insert` 静默覆盖；
业务请求 `rx.await` 无 deadline；写失败 `?` 早退泄漏 `pending` / `inflight`。

## 2. 目标形态

### 2.1 失败分类类型化（R1/R2）

```rust
// session/request.rs
pub(crate) enum RequestFailure {
    /// 服务器答了 JSON-RPC error：**请求级**失败，会话健康，不重启、不消耗预算。
    Server { code: i32, message: String },
    /// 通道不可用（写失败 / 发送端丢失 / reader 已退）：**会话级**失败，可重建。
    Channel(String),
    /// 在预算内没等到响应：请求级失败（服务器慢 ≠ 会话死），取消该请求即可。
    Timeout { method: String, budget: Duration },
    /// 被更新的同类请求取消（single-flight 语义，现有行为）。
    Cancelled,
}
```

`do_send_request` 返回 `Result<Value, RequestFailure>`（实现 `std::error::Error`，
既有 `anyhow` 调用点用 `?` 直接穿透）。`manager` 只对 `Channel` 进重启路径：

| 失败 | 重启 | 消耗 restart 预算 | 用户可见 |
| --- | --- | --- | --- |
| `Server` | 否 | 否 | 原样上抛（`AppError::Lsp`） |
| `Timeout` | 否 | 否 | 上抛（含方法与预算） |
| `Channel` | 是 | 是 | 上层重试一次 |
| `Cancelled` | 否 | 否 | `Ok(Null)`（不变） |

### 2.2 重启必须真的重建（R2）

重启路径在 `get_or_create_session` **之前**先 `close_session_for_restart(...).await`
（11-12 已实现：静默落终态 + 等序列收口）。否则「复用坏会话 + 计数器上涨」原样保留。

### 2.3 restart streak（R2）

- `session_store` 新增 `clear_restart(&key)`；只在**一次请求成功**后调用
  （成功的请求证明该会话可用）。
- **不得**在创建成功时清零 —— 否则崩溃循环每次都被清零，`MAX_RESTART_COUNT` 永不生效。
- 命中上限时除了 `Err`，必须让前端可见（状态栏 chip 进入 error + 文案，
  复用既有 `emit_session_error` 路径，不新造事件）。

### 2.4 id 空间唯一（R3）

`session/request.rs` 暴露 `pub(crate) fn next_request_id() -> RequestId`（唯一 allocator）；
`initialize`（现在硬编码 `1`）与 `shutdown`（现在硬编码 `1000`）都改用它。
`pending.insert` 若返回 `Some(prev)` → **不得静默覆盖**：`log::error!` + bail
（陈旧 sender 被 drop 会让前一个等待者误报「无响应」）。

### 2.5 业务请求 deadline（R4）

`LspSession` 新增 `request_timeout: Duration`，创建时取
`plugin.request_timeout_ms`（java/rust 120s），未声明回落 `DEFAULT_REQUEST_TIMEOUT`（15s，
与前端既有默认同值）。`do_send_request` 用 `tokio::time::timeout` 包住 `rx.await`；
超时路径：摘 `pending` → `inflight.complete` → 发 `$/cancelRequest` → 返回 `Timeout`。

### 2.6 写失败清理（R5）

`writer.send(...)` 失败时与超时同路径清理（摘 pending + complete inflight + `$/cancelRequest`
可选），再返回 `Channel`。

### 2.7 终态单写者（R6）

`instance.rs` 的 reader 出口新增 `init_completed: Arc<AtomicBool>`：握手完成前 reader 退出
**不**写终态（不推 error 事件），由 manager 的装配失败分支唯一落账。握手成功后 reader 退出
仍是唯一崩溃写者（既有语义不变）。

## 3. 失败矩阵（关闭/超时交错）

| 场景 | 期望 |
| --- | --- |
| 请求超时后响应迟到 | pending 已摘除 ⇒ 响应被丢弃；服务器侧已被 `$/cancelRequest` 通知 |
| 同一 single-flight 桶并发两条 | 旧请求 `Cancelled`（`Ok(Null)`），新请求正常等待 |
| 超时 + reader 同时退出 | 两条路径都可能摘 pending，均幂等（`remove` 返回 `None` 即跳过） |
| 写失败 | `Channel`，pending/inflight 已清，本轮不进 restart（由调用点决定） |

## 4. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 类型化 `RequestFailure` 而非 `anyhow` + downcast | 改 5 个调用点签名 | downcast 是隐式契约，新增失败种类不会强制消费点更新 |
| `Timeout` 不重启 | 慢服务器表现为请求失败而非自动恢复 | 重启一台正在索引的 JVM 要几十秒且必然更慢；失败信息可操作 |
| restart streak 只在成功请求后清零 | 一次成功即清零，长跑会话不受历史错误影响 | 「连续失败」才是有意义的预算；创建成功不清零（防崩溃循环绕过上限） |
| id 冲突直接 bail | 碰撞时该请求失败 | 静默覆盖会伪装成「无响应」，把 id 缺陷伪装成网络问题 |

## 5. 兼容与回滚

- 无 wire / 事件名变化；`Cancelled` 语义保持不变。
- 回滚 = revert 单个 commit；回滚后回到「任何错误都重启 + 计数不清零」。
- 风险：`Timeout` 不重启后，某些「服务器假死」场景不再自动恢复 —— 由用户可见错误重试，
  比悄悄重启更可诊断（`restart` 预算也因此不会被慢请求烧掉）。
