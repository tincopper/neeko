# LSP 域能力盘点（仓库实证，2026-09-17）

> 结论先行：自动导入与诊断的**主通道已在代码库中运行**。本清单逐项给出 file:line 证据，
> 设计文档（../design.md）的 Gap 分析与阶段划分以此为准。

## 1. 能力矩阵

| 环节 | 状态 | 证据 |
|---|---|---|
| Go 语言服务器（gopls）注册 | ✅ | `src-tauri/src/lsp/plugin/builtins/go.rs:7-11`（`gopls` 命令 + `go install ...gopls@latest` 安装兜底） |
| 语言服务器矩阵 | ✅ 17 种 | `src-tauri/src/lsp/plugin/builtins/`（go/java/rust_lang/typescript_family/python/csharp/clang_family/kotlin/lua/php/r/ruby/swift/elixir/sql + java_install） |
| LSP 客户端 | ✅ | `@codemirror/lsp-client` **6.2.5**（官方 CM6 LSP client，dist/index.js） |
| **补全接受时原子应用 additionalTextEdits** | ✅ **包内已实现** | `lsp-client/dist/index.js:969-971`：`item.additionalTextEdits` → 逐 edit `fromPositionChecked` 转换 → `option.apply = applyEdits(edits, text, null)`——**自动导入的主通道** |
| 补全源挂载 | ✅ | `src/features/lsp/hooks/lspClientManager.ts:122`：`createThemedServerCompletion()`（`lspCompletionInfoRenderer.ts:226`，包装包内 `serverCompletionSource`，override 全接管 + 主题化 info 面板） |
| 诊断渲染挂载 | ✅ 自组装 | `lspClientManager.ts:125-130`：**无需显式挂渲染器**——首次 `setDiagnostics` 经 `maybeEnableLint` 自动追加 lint 渲染扩展（`lintState.provide` 自带 wavy decorations + hover tooltip，@codemirror/lint 源码 ：127/:176 实证）。**禁止挂空 source 的 `linter()`**（idle 轮询会用空数组清掉推送诊断） |
| 诊断传输（Rust → 前端） | ✅ | Rust `diag_bus.rs` → Tauri 事件 `lsp-diagnostics-{projectPath}`（`src/shared/events.ts:31`）→ `TauriLspTransport.ts:81-87` 转成 JSON-RPC 推给 client |
| 诊断列表 UI | ❌ **孤儿组件** | `src/features/lsp/components/DiagnosticsPanel.tsx` 存在（severity 1/2/3/4 分组 :14-17、跳转 :49）但全仓无调用方 |
| hover / signatureHelp | ✅ | `lspClientManager.ts:123,125`；`lspHoverExtension.ts`（`$ /cancelRequest` 竞态处理 :64-66） |
| 文档同步 | ✅ | lsp-client LSPPlugin 生命周期（didOpen/didChange 由包管理，`useLspClient.ts:64-66` 注释） |
| go-to-definition | ✅ | `useLspNavigation.ts`（`textDocument/hover` :100、definition 链路） |
| **codeAction（quickfix 灯泡）** | ❌ | client 包**不导出** codeAction（dist 全 grep 无命中）；前端无任何 `textDocument/codeAction` 调用 |
| **workspace/applyEdit（server→client 编辑请求）** | ❌ **被吞** | Rust `server_request.rs:16-19` 只处理 workDoneProgress/create、registerCapability、workspaceFolders——未知 server 请求回 **MethodNotFound**（`workspace/applyEdit` 会命中该分支，session/instance.rs:312 调用点） |
| **会话健康度可观测** | ❌ | LS 启动/崩溃/能力激活无用户可见信号（progress 事件前缀已有 `lsp-progress-{projectPath}`，events.ts:33，未见消费 UI） |

## 2. 装配链（完整链路）

```
编辑器输入（CM6）
  └─ LSPPlugin（lsp-client）→ document sync（didOpen/didChange）
  └─ createThemedServerCompletion() → serverCompletionSource → LSP completion 请求
       └─ 补全接受 → additionalTextEdits 原子应用（自动导入 ✅ 包内）
  └─ serverDiagnostics() → squiggle 渲染（✅）
Rust 会话（session/instance.rs）
  └─ LS stdin/stdout ↔ JSON-RPC
  └─ publishDiagnostics → diag_bus → Tauri 事件 → TauriLspTransport → client（✅）
  └─ server→client 请求 → server_request.rs（仅 3 个白名单方法；applyEdit ❌ MethodNotFound）
```

## 3. 消费方与共享模型

- `acquireLspPlugin(projectPath, languageId, fileUri)`：client 按 (projectPath, languageId)
  池化共享（`idleRefCountedCache.ts`），per-file 扩展经 `withJdtLinkHandler` 注入
  （宿主闭包不进共享 client，`lspHoverExtension.ts:96-100`）。
- `useLspClient.ts`：每 tab 装配；languageId 同步映射 + 后端注册表收紧。
- 编辑器装配入口：`useEditorExtensions.ts:134-137`（lspClientExt 注入 CM）。

## 4. 已知风险点（实现期注意）

- **capability 协商**：lsp-client 是否向 LS 声明 completion/codeAction capability、
  server 侧是否需要显式开启（如 gopls unimported completions 的配置）——M0 实测项。
- **`server_request.rs` 白名单**：新增 server→client 方法必须显式转发，MethodNotFound
  兜底是既有语义（禁止改成无差别透传）。
- **DiagnosticsPanel 数据源**：组件是纯展示（props 传入），点亮需要诊断状态的单写点
  ——设计文档 D2 决策：lspStore 直采 Tauri 诊断事件（与 CM 渲染解耦）。
