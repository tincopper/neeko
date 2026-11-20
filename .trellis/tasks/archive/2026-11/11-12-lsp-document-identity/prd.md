# LSP 会话与文档身份：重启不得丢文档登记与编辑器所有权

## Goal

让「重启 = 替换」在**文档身份**这一层也成立：重启后服务器端仍持有同一批已打开文档（同 uri、
同版本号语义），后端不得因为一次重启就退化成「按磁盘文本代开」，更不得把另一个子工程的会话
当成自己的。

## Background

审计证据见 `.trellis/tasks/11-12-lsp-graceful-shutdown/research/audit-{channel,orchestration,contracts}.md`：

- `session_store.rs:242-252` 的 `close_session` 清掉 `clear_open_documents` + `editor_owned`，
  而 `manager.rs:658` 是**新会话建好之后**才 `reopen_documents` ⇒ 重放恒为
  `re-opened 0 doc(s)`（该机制是死代码）。后果链：服务器端口该文档消失、编辑器不重发 didOpen
  （`useLspClient` 的 effect deps 不含会话状态）⇒ 无诊断无补全，直到用户编辑；
  期间任何 `lsp_request` / `lsp_go_to_definition` 因 `editor_owned=false` 判定
  「需要后端代开」→ 按**磁盘文本**代开 → 未保存缓冲区坐标整体错位（lsp-domain.md §7.5 记过的事故形态）。
- 登记表的 `text/version` 只在 didOpen 时写入，`didChange`（`commands.rs:150-173`）不更新 ⇒
  即使重放修好，重放出去的也是 didOpen 时刻的旧文本。
- `commands.rs:118-147` 的 `lsp_open_document` 是 didOpen 的**第四个**出口（自拼 params +
  自行登记 + 裸发），绕过唯一出口 `send_did_open`（无「重复先补 didClose」、不走
  `next_open_version`）。前端 `lspOpenDocument/ChangeDocument/CloseDocument` 零调用（死 IPC 面）。
- 会话 key 只有 `project:lang`，`DocumentScoped` 定根（monorepo 子包的 `node_modules`）不进身份 ⇒
  先开者定根、另一个子工程复用错根，按错根解析 import。
- `builtins/typescript_family.rs` 让 `.ts/.tsx/.js/.jsx` 四个 language_id 共用同一个 server 二进制，
  但会话按 language_id 建 ⇒ 任意 TS+TSX 工程起两个 tsserver。

## Requirements

- **R1**：重启路径保留 didOpen 登记表与 `editor_owned`（只摘会话对象），让
  `reopen_documents` 真的重放；停止/项目停用仍清空（服务器端确实忘了这些文档）。
- **R2**：`didOpen` 只有一个出口（`LspManager::send_did_open`）；删除 `lsp_open_document`
  命令与前端 `lspOpenDocument/lspChangeDocument/lspCloseDocument`（无消费点）。
- **R3**：登记表文本/版本必须与服务器同源：`lsp_transport` 转发的 `didChange` 要更新登记表
  （全量同步 → 文本+版本；增量同步 → 只推版本并标记文本陈旧，重放时记录告警）。

> 范围修正（2026-11-12）：原 R3「文档定根进会话身份」与原 R4「同一 server 二进制只建一个会话」
> 都要求改 `session_key` 语义，会波及事件名（`lsp-*-{projectPath}` 载荷里的 languageId）、
> 命令（`lsp_request` / `lsp_stop_session` …）、前端 store 分片与状态栏 chip。
> 两者已拆出为独立任务，本轮不做（见 Out of scope），避免把「文档身份」这件事拖成重构。

## Acceptance Criteria

- **AC1**：`restart_keeps_open_documents` —— 重启后 `reopen_documents` 重放 ≥1 条 didOpen，
  且版本号继续单调（不低于重启前）。
- **AC2**：`restart_keeps_editor_ownership` —— 重启后 `is_editor_owned` 仍为真
  （否则后端会拿磁盘文本代开编辑器里的未保存缓冲区）。
- **AC3**：`stop_clears_document_registry` —— 用户 stop / 项目停用仍清空登记表与所有权
  （行为不变：那是「会话就此结束」）。
- **AC4**：`did_change_full_sync_updates_registry` / `did_change_incremental_bumps_version` ——
  `lsp_transport` 转发的 didChange 使登记表版本前进；全量同步时文本同步更新。
- **AC5**：`rg -n 'send_notification\("textDocument/didOpen"' src-tauri/src` 零命中
  （只有 `send_did_open` 内部）；`lsp_open_document` / `lsp_change_document` /
  `lsp_close_document` 三个命令与三个前端 wrapper 已删除。
- **AC6**：`cargo test --manifest-path src-tauri/Cargo.toml --lib` 全绿；既有
  `send_did_open_duplicate_sends_close_before_reopen` 与
  `send_did_open_version_regression_still_reopens_and_advances` 语义不变。

## Out of scope（拆出，另行立项）

1. **会话身份含文档定根**：monorepo 两个子包各有 `node_modules` 时，先开者定根、后者复用错根。
   需要 `session_key` 纳入 root（或会话内校验根不一致即换根重建），并同步事件载荷 / 命令 /
   前端分片。
2. **同一 server 二进制的多个 language_id 只建一个会话**（TS/TSX 双 tsserver）：需要插件声明
   「服务身份」并让会话 key 用它 —— 与第 1 项同一类改动（身份重构）。
3. **重启后由前端重发 didOpen**（编辑器是文本唯一真相）：这是根治「登记表文本可能陈旧」的
   方向，但需要前端 `useLspClient` 的 effect 依赖会话相位；本轮以「登记表 + didChange 同步」
   先立住，前端侧留作后续。
