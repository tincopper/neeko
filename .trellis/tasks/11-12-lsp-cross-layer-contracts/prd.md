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

- **R1**（红线 4）：`lsp_request` / `lsp_transport` 统一按字节预算封顶并返回**明确错误**
  （含实际字节数与建议的收窄方式），前端不得静默拿到被截断的 JSON。
- **R2**：诊断权威副本按 `languageId` 分区，会话边界只清该语言（诊断事件需补 `languageId`，
  `diag_bus` 已有该字段）。
- **R3**（红线 14）：`relatedInformation` 要么删除声明，要么给出渲染色（`DiagnosticRow` / hover）。
- **R4**：状态词表单一来源：`indexing` 必须经 `publish_status`（或删除该变体并同步注释）；
  `LspSessionInfo.status` 用字面量 union 序列化并去掉前端 `as`；事件常量加**跨栈**断言
  （照 `src/shared/__tests__/sessionsEventConstant.test.ts` 的形态反向读源码）。
- **R5**：`$/progress` 两端形态对齐；无消费点就删掉该条转发。

## Acceptance Criteria

- **AC1**：超预算响应返回 `AppError`（有测试：构造 3MB 假响应，断言错误文案含字节数）。
- **AC2**：`clear_diagnostics_only_affects_that_language` —— Java 会话边界后 Rust 诊断仍在。
- **AC3**：`rg -n 'relatedInformation' src/` 零命中，或存在渲染测试。
- **AC4**：改 `src/shared/events.ts` 任一 `LSP_*` 常量（不留别的改动）→ 测试变红（变异验证）。
- **AC5**：关闭后不再有 `ready` 事件（测试：CLOSED 相位 + 迟到 progress end）。

## Out of scope

- 诊断波浪线锚定模型（lsp-domain.md §2 已定案）；Problems 面板性能（§5 已定案）。
