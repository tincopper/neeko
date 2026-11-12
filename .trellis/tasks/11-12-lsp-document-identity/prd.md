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

- **R1**：重启路径保留 didOpen 登记表与 `editor_owned`（只摘会话对象），或在新会话建立后按登记表
  重放；重放不得使用陈旧文本 —— `didChange` 必须同步登记表。
- **R2**：`didOpen` 只有一个出口（`LspManager::send_did_open`）；删除 `lsp_open_document` 命令与前端
  `lspOpenDocument/ChangeDocument/CloseDocument`（无消费点），或让命令体委托唯一出口。
- **R3**：文档定根必须进会话身份（key 或会话内校验）：命中会话但根不一致 → 换根重建，且能被观测。
- **R4**：同一 server 二进制/服务身份的多个 language_id 只建一个会话（插件声明「服务身份」）。

## Acceptance Criteria

- **AC1**：`restart_keeps_open_documents` —— 会话重启后 `reopen_documents` 重放 ≥1 条 didOpen，
  且版本号继续单调（不低于重启前）。
- **AC2**：`did_change_updates_registry_text_and_version` —— `didChange` 后登记表文本/版本同步。
- **AC3**：`rg -n 'send_notification\("textDocument/didOpen"' src-tauri/src` 零命中（只有 `send_did_open` 内部）。
- **AC4**：monorepo 双子包场景：第二个子包不复用处根不一致的会话（有测试，用 tempdir 造两个 `node_modules`）。
- **AC5**：TS+TSX 同时打开只起一个 tsserver（断言 store 里会话数 = 1）。

## Out of scope

- `-data` 归属（jdtls workspace 目录）—— 11-12 已记 out of scope。
- 前端 `@codemirror/lsp-client` 的 effect deps 改造（若 R1 走「保留登记表 + 重放」，前端零改动）。
