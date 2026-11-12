# 实施计划：LSP 文档身份

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::session_store
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::manager
npx vitest run src/features/lsp
```

---

## S1 · 拆开 `take_session` / `close_session`（R1 / AC1-AC3）

- [ ] **Red**：
  - `take_session_keeps_documents_and_ownership`（`session_store.rs`）：登记 2 个文档 + claim
    一个 uri → `take_session` → 登记表仍有 2 条、`is_editor_owned` 仍为真、会话已摘除。
  - `close_session_clears_documents_and_ownership`：既有行为保持不变（现在补成显式用例）。
- [ ] **Green**：`take_session` = `remove(key)` only；`close_session` = `take_session` +
  `clear_open_documents` + `clear_restart` + `editor_owned.remove`。
- [ ] `manager::take_for_close`：`Silent` → `take_session`；`Announce` → `close_session`。
  同步改掉 manager 里「`close_session_for_restart` 内部会 `clear_restart`」的注释。
- [ ] **Gate A**：`rg -n "close_session\(&key\)" src-tauri/src/lsp/manager.rs` 只出现在 Announce 分支
      （Silent 分支必须走 `take_session`）。

## S2 · 重放真的有数据（AC1）

- [ ] **Red**：`restart_replays_open_documents`（`manager.rs`）：用 `live_stub_session_with_writer`
      的变体（或直接构造 session）登记 2 个文档 → 走 `close_session_for_restart(...).await` →
      断言 `reopen_documents` 被调用时收到 2 条（用 writer 信道观察：2 条 `didClose`+`didOpen`
      或 `didOpen`，与 `send_did_open` 的「重复先补 didClose」一致）。
- [ ] **Green**：必要时修正 `reopen_documents` 的版本推进（用 `next_open_version(previous)`）。
- [ ] **Gate B**：日志 `re-opened N doc(s)` 在 N>0 时出现（可用测试断言返回值）。

## S3 · didChange 同步登记表（R3 / AC4）

- [ ] **Red**：
  - `update_open_document_full_sync_replaces_text`：`full_text = Some("x")` → 文本与版本都更新。
  - `update_open_document_incremental_bumps_version_only`：`full_text = None` → 版本前进、文本不变。
  - `update_open_document_ignores_unregistered_uri`：未登记 uri → 不造条目。
  - `did_change_through_transport_updates_registry`（`commands.rs` 侧）：转发一条全量 didChange →
    登记表文本/版本同步。
- [ ] **Green**：`session_store::update_open_document` + `manager::record_document_change` +
      `lsp_transport` 的 `textDocument/didChange` 分支（全量判定：`contentChanges` 里没有 `range`）。
- [ ] **Gate C**：`rg -n "textDocument/didChange" src-tauri/src/lsp` 只有两处
      （`lsp_transport` 的登记分支 + 通用转发注释）。

## S4 · 删死 IPC 面（R2 / AC5）

- [ ] **Red**：`lspApi` 的类型级断言——`rg` 判据写进测试或 CI 护栏（本任务先手工核对）。
- [ ] **Green**：
  - Rust：删 `lsp_open_document` / `lsp_change_document` / `lsp_close_document` 三个命令 +
    `lib.rs` 的 handler 注册 + `commands.rs` 里未用的 import。
  - 前端：删 `lspApi.ts` 里的三个 wrapper 与其类型（`LspDocumentChange` 等）。
- [ ] **Gate D**：`rg -n "lsp_open_document|lsp_change_document|lsp_close_document|lspOpenDocument|lspChangeDocument|lspCloseDocument" src src-tauri` 零命中。

## S5 · 收尾

- [ ] `cargo test --lib` 全绿；`cargo clippy --all-targets -- -D warnings` 干净。
- [ ] `npx vitest run src/features/lsp src/features/editor` 全绿（前端改动只在 api 层）。
- [ ] `pnpm check:quick` 全绿（注意 `check_*` 护栏：事件名、didOpen 唯一出口相关判据）。
- [ ] spec：`.trellis/spec/backend/lsp-domain.md` §7 坑 5（didOpen 唯一出口）补一句
      「重启保留登记表（`take_session`），停止清空」与「didChange 经 `lsp_transport` 同步登记表」。

## 回滚点

- S1 是本次核心（重启语义）；S4 独立可回滚（删命令行）。
- 无 schema / wire 变化；前端只删零调用 wrapper。
