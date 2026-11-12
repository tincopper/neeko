# 实施计划：LSP IPC 边界与契约执行侧

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::
npx vitest run src/features/lsp src/shared/__tests__
```

---

## S1 · IPC 字节预算（R1 / AC1）

- [ ] **Red**（`commands.rs` 或 `types.rs` 的测试模块）：
  - `response_budget_rejects_oversized_payload`：`enforce_response_budget("textDocument/references",
    json!) ` 用 2MiB+ 字符串 → `Err`，文案含 `bytes`、method 与 `budget`。
  - `response_budget_accepts_small_payload`：小响应 → `Ok`。
- [ ] **Green**：`lsp/types.rs` 加 `LSP_RESPONSE_MAX_BYTES`（2 MiB）+
      `pub(crate) fn enforce_response_bytes(method: &str, bytes: usize) -> Result<(), AppError>`；
      `lsp_transport` 用已序列化字符串的长度调用它；`lsp_request` 用
      `serde_json::to_vec(&value)` 量长度后调用（注释写明「多一次序列化是有意的」）。
- [ ] **Gate A**：`rg -n "LSP_RESPONSE_MAX_BYTES" src-tauri/src` 恰好 3 处（定义 + 两个命令）。

## S2 · 删 `relatedInformation` 假声明（R2 / AC2）

- [ ] **Red** → 直接改 + 既有 capabilities 测试（`client_capabilities_*`）保持绿。
- [ ] **Green**：删 `publishDiagnostics.relatedInformation`；spec 的「能力声明」条目补一句
      （「消费点不存在 ⇒ 不声明」，与 `progressReportProvider` 同族）。
- [ ] **Gate B**：`rg -n "relatedInformation" src-tauri/src` 零命中。

## S3 · `indexing` 经 lifecycle（R3 / AC3）

- [ ] **Red**：`indexing_event_is_gated_by_terminal_phase` —— lifecycle 置 `Stopped` 后调用
      progress begin 处理 → 不产生 `indexing` 事件（RecordingTransport 为空）。
- [ ] **Green**：`notify.rs` 改走 `publish_status(... LspSessionStatus::Indexing ...)`
      （注意不要改变 `ready`/`progress` 的既有语义与文案）。
- [ ] **Gate C**：`rg -n '"indexing"' src-tauri/src/lsp` 只出现在 `status.rs` 的词表与测试里。

## S4 · 跨栈事件常量断言（R4 / AC4）

- [ ] **Red**：新建 `src/shared/__tests__/lspEventConstant.test.ts`：
      读 `src-tauri/src/lsp/types.rs`，正则抠 6 个常量声明（每个必须恰好 1 条），与
      `src/shared/events.ts` 比较。先让它在「故意改一个常量」时红（变异验证），再恢复。
- [ ] **Green**：无需改实现（若发现真实不一致，先报告再修）。
- [ ] **Gate D**：`npx vitest run src/shared/__tests__/lspEventConstant.test.ts` 通过；
      变异（改一个常量）后必红。

## S5 · 监听器生命周期（R5 / AC5）

- [ ] **Red**：`tauriLspTransport` 测试：让 `listen` 返回一个**延迟 resolve** 的 promise，
      在 resolve 前调用 `destroy()`，断言 resolve 后立即注销（`safeUnlisten` 被调用 /
      计数为 1 次），且 `unlistenX` 保持 null。
- [ ] **Green**：三处 `.then(...)` 加 `if (this.destroyed) { safeUnlisten(u)(); return; }`；
      删除 `$/progress` 监听器与对应 `unlistenProgress` 字段。
- [ ] **Gate E**：`rg -n '\$/progress' src/features/lsp/transport` 零命中；
      `destroy_twice_is_safe` 等既有测试保持绿。

## S6 · 收尾

- [ ] `cargo test --lib` 全绿；`cargo clippy --all-targets -- -D warnings` 干净。
- [ ] `npx vitest run src/features/lsp src/shared/__tests__ src/features/editor` 全绿。
- [ ] `pnpm check:quick` 全绿。
- [ ] spec 更新：`lsp-domain.md` 的「能力声明必须与实现一致」补 `relatedInformation`；
      新增一句「IPC 主通道也有字节预算（`lsp/types.rs::LSP_RESPONSE_MAX_BYTES`）」。

## 回滚点

- S1 独立（新增错误分支）；S3 独立（事件路径）；S5 独立（前端）。
- 无 schema / wire 字段变化。
