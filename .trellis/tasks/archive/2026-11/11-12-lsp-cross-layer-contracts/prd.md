# LSP 跨端契约与资源边界：2MB 预算与诊断分区

## Goal

把 LSP 这条主通道的资源边界与状态词表收干净：主通道必须有自己的载荷预算（红线 4），
诊断的清除粒度必须与会话粒度一致（否则误清别的语言），状态与事件必须同源、可被改动逼红。

## Background

审计证据见 `.trellis/tasks/11-12-lsp-graceful-shutdown/research/audit-contracts.md`：

- `commands.rs:68-108`（`lsp_request`）与 `commands.rs:467-573`（`lsp_transport`）把服务器响应
  **原样** `serde_json` 返回，**无任何字节预算**；而 `lsp_get_server_logs` 有 1.5MB 双预算、
  `lsp_go_to_definition` 预读封 512KB、`lsp_read_preauthorized_file` 512KB —— 主通道反而是缺口。
  `textDocument/references` 大仓上万条 Location、`documentSymbol`、带文档的 completion 都可能单次 >2MB。
- `src/features/lsp/store/lspStore.ts:365-370` 会话边界的 `clearProjectDiagnostics(projectPath)` 是
  **项目粒度**，而边界由单一 languageId 触发 ⇒ 同仓 rust+java 项目里点 Java 的重启/Java 崩溃
  会把 Rust 的既有诊断整块清掉，服务器不会重推未变更文件 ⇒ 波浪线永久消失直到编辑。
- `session/instance.rs:895` 声明 `publishDiagnostics.relatedInformation: true`，`src/` 全仓零消费
  （红线 14：声明即契约）。
- `tauriLspTransport.ts:186-196` 按 `{token, value:{kind,…}}` 读 `$/progress`，后端
  （`transport.rs:126-133`）发的是**扁平** `{languageId, token, kind, message, percentage}` ⇒
  转发给 lsp-client 的只有 `token`。当前库无消费点故无症状，属定时炸弹。
- `lsp/types.rs:211-231` 的「事件名与前端 mirror 一致」测试只比对**同文件内字面量**，从不读
  `src/shared/events.ts` ⇒ 改前端常量 CI 全绿、运行期静默失联（`LSP_PROGRESS_EVENT_PREFIX`
  写错成 `lsp-project-` 的事故形态）。
- `LspSubscriptionBridge.tsx:39` 用 `as` 把后端自由字符串强转进前端 union；`LspSessionInfo` 是
  全仓 LSP 唯一 snake_case DTO 且注释只列三个状态（实际六态）。
- `session/notify.rs:124-131` 的 progress `end` 直接推 `ready`，不经 `publish_status` / 不判终态
  ⇒ 关闭后前端仍收到 `ready`（chip 复活）；`notify.rs:89` 的 `indexing` 同理绕过 lifecycle，
  而 `snapshot()` 读 lifecycle 会报 ready ⇒ 同一事实两份记录。
- `tauriLspTransport.ts` 的 `listen().then(u => this.unlistenX = u)` 在 `destroy()` 早于 resolve
  （HMR / 测试 reset / 调小 idle 阈值）时泄漏 3 个监听器。

## Requirements

- **R1（红线 4）**：`lsp_request` / `lsp_transport` 的响应体按**字节**封顶（2 MiB），
  超限返回明确错误（含实际字节数与 method），不得把无界 JSON 直接交给 Tauri IPC。
- **R2（红线 14）**：删除 `publishDiagnostics.relatedInformation` 假声明（全仓零消费）。
- **R3（状态单写点）**：`$/progress begin` 的 `indexing` 事件经 `publish_status` 发出，
  受 lifecycle 终态门约束；关闭后的迟到 `indexing` / `ready` 不得复活 chip。
- **R4（红线 5 的执行侧）**：新增**跨栈**断言：读取 `src-tauri/src/lsp/types.rs` 的常量声明，
  与 `src/shared/events.ts` 逐字比较（形态照 `src/shared/__tests__/sessionsEventConstant.test.ts`）。
- **R5（监听器不泄漏）**：`tauriLspTransport.setup()` 的三个 `listen().then()` 在 `destroy()`
  已发生时立即注销；顺带删除**死**的 `$/progress` 转发（`@codemirror/lsp-client` dist 内无
  `$/progress` 消费点，实测零命中；`lspStore` 的 busy 投影有自己的监听）。

> 范围修正（2026-11-12）：原 R2「诊断按 languageId 分区」与原 R4「status union + camelCase」
> 都已拆出（前者要改事件载荷契约与前端 store 形状，后者是纯类型卫生、当前无失效）。
> 本任务只收「IPC 边界 + 红线执行侧 + 监听器生命周期」这一束，避免把契约变更混进小修批次。

## Acceptance Criteria

- **AC1**：`lsp_request` / `lsp_transport` 超预算返回 `AppError`，文案含字节数与 method
  （测试构造 2MiB+ 假响应）；预算内原样返回。
- **AC2**：`rg -n 'relatedInformation' src-tauri/src` 零命中。
- **AC3**：关闭后迟到的 `$/progress begin` 不再产生 `indexing` 事件（测试：lifecycle 已终态）。
- **AC4**：故意改 `src/shared/events.ts` 的任一 `LSP_*` 常量（不留其他改动）→ 新跨栈断言变红
  （变异验证）。
- **AC5**：`destroy()` 在 `listen()` resolve 之前调用时，三个监听器仍被注销（测试断言
  `safeUnlisten` 被调用 / 事件不再送达）；`rg -n '\$/progress' src/features/lsp/transport` 零命中。
- **AC6**：`cargo test --lib` 全绿；`npx vitest run src/features/lsp` 全绿。

## Out of scope

- 诊断波浪线锚定模型（lsp-domain.md §2 已定案）；Problems 面板性能（§5 已定案）。
