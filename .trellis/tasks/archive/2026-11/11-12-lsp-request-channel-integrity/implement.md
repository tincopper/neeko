# 实施计划：请求通道健全性

TDD 顺序，每步先写失败测试。定向命令：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::session::request
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::manager
```
收尾跑一次 `cargo test --lib` + `pnpm check:quick`（Rust 侧缺口已知：`check:quick` 不跑 cargo test）。

---

## S1 · 失败分类类型化（`session/request.rs`）

- [ ] **Red**：
  - `server_error_response_is_a_request_failure`：喂 `Message::Response` 带 `error.code = -32602`
    → 返回 `RequestFailure::Server { code: -32602, .. }`（不是 `Channel`）。
  - `writer_closed_is_a_channel_failure`：writer 接收端已 drop → `RequestFailure::Channel`。
  - `cancelled_request_stays_ok_null`：既有语义不变（`Ok(Value::Null)`）。
- [ ] **Green**：定义 `RequestFailure`（`Debug + Display + std::error::Error`），
      `do_send_request` 返回 `Result<Value, RequestFailure>`；更新调用点
      （`manager.rs` 两处、`instance.rs::send_request_async`、`request.rs` 内联测试）。
- [ ] **Gate A**：`rg -n "LSP error \(" src-tauri/src/lsp` 只剩一处（构造 `RequestFailure::Server`）。

## S2 · 写失败与超时都清理 pending/inflight（R4/R5）

- [ ] **Red**：
  - `write_failure_clears_pending_and_inflight`：writer 关闭后断言 `pending` 为空、
    `inflight` 无残留（用 `InflightRequestTracker` 的可观测方法）。
  - `silent_server_times_out_and_cancels`：预算 50ms、无响应 → `RequestFailure::Timeout`，
    `pending` 空，且 writer 收到一条 `$/cancelRequest`。
- [ ] **Green**：`do_send_request` 增加 `budget: Duration` 参数（由 `LspSession::request_timeout` 提供）；
      写失败/超时统一走 `cleanup_request(...)`（摘 pending + complete inflight + cancel）。
- [ ] **Gate B**：`rg -n "rx\.await" src-tauri/src/lsp` 无裸等待（只剩 `tokio::time::timeout` 内层）。

## S3 · id 空间唯一（R3）

- [ ] **Red**：
  - `next_request_id_comes_from_one_allocator`：连续取 3 个 id 单调递增；`initialize` 与
    `shutdown` 路径使用的 id 也来自它（用可注入的 allocator 或直接断言不与业务 id 冲突）。
  - `pending_insert_refuses_duplicate_id`：同 id 二次插入 → `Err`（不覆盖）。
- [ ] **Green**：暴露 `next_request_id()`；`instance.rs` 的 init / shutdown id 改用它；
      `pending` 插入改为「已存在即失败」。
- [ ] **Gate C**：`rg -n 'RequestId::from\((1|1000)i32\)' src-tauri/src` 零命中。

## S4 · restart streak + 重启真的重建（R2）

- [ ] **Red**：
  - `server_error_does_not_consume_restart_budget`：一次 `-32602` 后 `restart_count` 不变、
    不发出 session 重建（可用 `SessionFactory` 计数桩）。
  - `successful_request_resets_restart_streak`：先制造 3 次 `Channel` 失败（计数 3），
    再让一次请求成功 → `restart_count == 0`。
  - `channel_failure_rebuilds_the_session`：失败后重试路径必须**关掉旧会话**再建
    （断言旧会话已从 store 摘除 / 工厂被调用第二次）。
- [ ] **Green**：`session_store::clear_restart`；manager 只对 `Channel` 进重启路径，
      且重启前先 `close_session_for_restart(...).await`；命中 `MAX_RESTART_COUNT` 时
      经 `emit_session_error` 让前端可见。
- [ ] **Gate D**：`rg -n "Will restart" src-tauri/src/lsp` 只剩 `Channel` 分支一处。

## S5 · 终态单写者（R6）

- [ ] **Red**：`handshake_failure_reports_one_error`：让假服务器在 initialize 前退出 →
      前端（RecordingTransport）收到的 error 事件**恰好一条**；文案与
      `get_server_info().outcome` 同源。
- [ ] **Green**：`init_completed: Arc<AtomicBool>`；reader 出口在未完成握手时不写终态；
      manager 装配失败分支保持唯一落账。
- [ ] **Gate E**：既有 `on_reader_exit_emits_error_with_inlined_evidence`
      与 `reader_exit_after_close_is_silent` 语义不变。

## S6 · 收尾

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` 全绿（≈2740 用例）。
- [ ] `pnpm check:quick` 全绿（注意 `check_nondeterministic_event_assertions`：
      manager/request 已属非确定性域时，观察者断言只能单向可达或差分式）。
- [ ] spec 更新：`.trellis/spec/backend/lsp-domain.md` 增「请求级失败 vs 会话级失败」小节，
      写明 `RequestFailure` 分类表、streak 清零规则、id 唯一 allocator。

## 回滚点

- S1/S2 可独立回滚（新增类型与清理路径）。
- S4 是本次行为变更的真正落点（不再对 error response 重启）；回滚它即回到旧行为。
- 无 schema / wire 变化。
