# LSP 域能力盘点（仓库实证，2026-09-17）

> 结论先行：自动导入与诊断的**主通道已在代码库中运行**。本清单逐项给出 file:line 证据，
> 设计文档（../design.md）的 Gap 分析与阶段划分以此为准。

## 1. 能力矩阵

| 环节 | 状态 | 证据 |
|---|---|---|
| Go 语言服务器（gopls）注册 | ✅ | `src-tauri/src/lsp/plugin/builtins/go.rs:7-11`（`gopls` 命令 + `go install ...gopls@latest` 安装兜底） |
| 语言服务器矩阵 | ✅ 17 种 | `src-tauri/src/lsp/plugin/builtins/`（go/java/rust_lang/typescript_family/python/csharp/clang_family/kotlin/lua/php/r/ruby/swift/elixir/sql + java_install） |
| LSP 客户端 | ✅ | `@codemirror/lsp-client` **6.2.5**（官方 CM6 LSP client，dist/index.js） |
| **补全接受时原子应用 additionalTextEdits** | ⚠️ **仅非 snippet 分支（已 patch 修正，2026-09-18 复核）** | 上游 `dist/index.js:966-977` 把「插入文本」与「附加编辑」写成**互斥分支**：`insertTextFormat == 2`（snippet，gopls 的函数补全 `fmt.Println(${1:a ...any})`）直接 `option.apply = …snippet(…)` 并**丢弃** `additionalTextEdits` —— 即"接受补全后 import 不落"。本项目以 `patches/@codemirror__lsp-client@6.2.5.patch` 修正：用捕获 shim 拦下 `snippet()` 的内部 dispatch，把附加编辑合并进**同一事务**（原子 + 单步撤销）。护栏见 `src/features/lsp/hooks/__tests__/lspCompletionApplyEdits.test.ts` |
| **jdtls：附加编辑内联 vs resolve** | ✅ **两条路都通（2026-09-19 复核，推翻 09-18 的"无 resolve 通道故禁止"）** | jdtls **也读标准能力** `completionItem.resolveSupport.properties`，不只它私有的 `extendedClientCapabilities.resolveAdditionalTextEditsSupport`。实测（jdtls 1.61.0 + JDK 21，未导入 `List`）：不声明 → **33/33** 内联；声明 `["additionalTextEdits"]` → 内联 **0**，改由 `completionItem/resolve` 返回 `import java.awt.List;`。现状：私有 flag 仍禁止声明（`plugin/builtins/java.rs` 单测钉死），标准能力**已全局声明**并由通用 resolve 通道接住 |
| **rust-analyzer：flyimport 候选门控** | ✅ **必须声明标准 resolveSupport，否则候选整条不发（2026-09-19 实证）** | 实测（r-a 1.97.1，scratch crate 普通 fn 体内 `let x: HashM;`；对照实验只改能力声明）：不声明 → 108 项、**无 `HashMap`**；声明 → 109 项、`HashMap<…>` 居首，编辑走 `completionItem/resolve`（返回 `use std::collections::HashMap;`）。声明位于 `src-tauri/src/lsp/session/instance.rs::build_client_capabilities`（**全局**，不按插件 —— 三种服务端策略由同一套 resolver 兜住） |
| **gopls：对该声明无感** | ✅ 恒内联 | 实测（gopls v0.23.0，`fmt.Pri`）：声明前后均为 3 项且全部内联 `import "fmt"` |
| **completionItem/resolve 通用通道** | ✅ | `src/features/lsp/hooks/lspCompletionResolve.ts`（WeakMap 去重、原样回传原始 item、失败静默）；接线 `lspCompletionInfoRenderer.ts`（首个候选预热 + 选中即解析）；取回的编辑由 patch 在**接受时**并入同一事务。**坑（2026-09-19 实测踩过）**：`neekoNeedsResolve` 必须由 **patch 在构建期**按 `item.data != null` 标注 —— 等调用方拿到 `options` 再标就晚了（装 `apply` 的分支早已求值，延迟项退化成插入裸 label，import 不落）。运行时回归：`lspCompletionApplyEdits.test.ts`（用假 view 驱动真实库代码，断言一次 dispatch 同时含插入与 import） |
| **jdtls：进度通道取决于我们的声明** | ⚠️ **禁止声明 `progressReportProvider`（2026-09-18 实证）** | 实测（jdtls 1.61.0 + JDK 21 + pom.xml）：声明 `true` → jdtls 独占 `language/progressReport`（43 条）、标准 `$/progress` **0 条**（本栈零消费 → 导入进度全丢）；不声明 → 标准 `$/progress` **36 条**（`Synchronizing projects` / `Building` / `Initialize Workspace`）。故**禁止声明**（`plugin/builtins/java.rs` 已删并加单测钉死） |
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
- **resolve 竞态（2026-09-19）**：声明 `resolveSupport` 后，jdtls / rust-analyzer 的
  import 编辑**只在** `completionItem/resolve` 里下发。首个候选预热 + 选中即解析已把窗口
  压到极小，但用户快于 resolve 时仍退化为"插入标识符但不带 import"（= 声明之前的行为）。
  **禁止**为追平而补第二次 dispatch —— 会拆成两段 undo 并引入坐标漂移；要收紧窗口只能
  改预热策略。
- **`data` 字段是 resolve 的凭据**：`@codemirror/lsp-client` 构建 CM6 option 时只拷贝固定
  字段、**丢掉 `data`**（并连带丢掉整个原始 item）。`patches/@codemirror__lsp-client@6.2.5.patch`
  以 `option.lspItem = item` 透出，护栏见 `lspCompletionApplyEdits.test.ts`；判定"该项需要
  resolve"的唯一通用信号就是服务器给了 `data`。
- **`server_request.rs` 白名单**：新增 server→client 方法必须显式转发，MethodNotFound
  兜底是既有语义（禁止改成无差别透传）。
- **DiagnosticsPanel 数据源**：组件是纯展示（props 传入），点亮需要诊断状态的单写点
  ——设计文档 D2 决策：lspStore 直采 Tauri 诊断事件（与 CM 渲染解耦）。
