# PRD：编辑器 LSP 自动导入与诊断提示体系

## Goal

让用户在编辑器内获得业界 IDE 水平的「写代码即被辅助」体验：输入 `fmt.Println()` 时
自动导入 `fmt` 包、代码有误时即时看到错误/警告（squiggle + 问题列表）、并可从诊断
一键修正（quickfix）。

**关键事实**（research/lsp-capability-matrix.md 实证）：主通道已在代码库运行——
lsp-client 补全接受已原子应用 `additionalTextEdits`（自动导入核心）、gopls 已注册、
`serverDiagnostics` 已装配。本任务 = **点亮未接线的部分 + 补齐缺失通道**，不是从零实现。

## Requirements

- **R1 诊断可视化闭环**：`DiagnosticsPanel`（现存孤儿组件）接入诊断数据流——诊断状态
  单写点为 lspStore（直采 Tauri `lsp-diagnostics-{projectPath}` 事件，与 CM 渲染解耦）；
  面板展示当前文件诊断（severity 分组 + 点击跳转行）；编辑器内提供稳定入口（可见性与
  挂载点实现期从既有面板/dock 模式中取最小侵入方案，设计文档给出判定标准）
- **R2 会话健康度可观测**：LS 生命周期信号（starting / running / failed / stopped，
  按语言）进 status-bar——用户能自答「为什么没有提示」（LS 没起来 ≠ 没有该功能）
- **R3 codeAction 通道**：诊断驱动的 quickfix——后端 `server_request.rs` 新增
  `workspace/applyEdit` 转发（进白名单，转 Tauri 事件）；前端 codeAction 请求封装 +
  灯泡入口（诊断行内）+ applyEdit 原子应用
- **R4 导入策略三态**（Ask/Auto/Never）：控制补全接受时是否自动应用 additionalTextEdits
  （默认 Auto；Ask 用于多候选场景弹选择）
- **R5 语言无关性（强制约束）**：以上全部能力通过 LSP 传输与能力协商实现，**禁止**
  任何语言特定逻辑（包名表、正则匹配、按语言分支 UI）——新 LS 接入即自动获得全部能力

## Acceptance Criteria

- [x] AC1（R1）：打开含类型错误的文件 → 编辑器 squiggle（既有）+ 问题列表显示该诊断
      （severity 分组、点击跳转对应行）；无诊断时列表空态（2026-09-18 `d8d44697` 落地：
      Problems 面板 + lspStore 诊断副本 + code 贯通 + 信封修复 + lspDiagnosticsProjection
      重放器——波浪线消失根因为 reconfigure 丢弃 lint 渲染器，已修）
- [x] AC2（R2）：gopls/jdt.ls 启动、就绪、崩溃三态在 status-bar 可见；崩溃含重试入口
      （2026-09-18 M2 落地：Rust 生命周期事件全接线 + reader 崩溃检测/panic 兜底 +
      快照派生 error + 前端 error chip/重试；LspHealthCheck 复核 3 个 P1 已修。
      同日复审后收敛：生命周期真相归一到 `session/lifecycle.rs::Lifecycle`（终态吸收 +
      幂等，区分「优雅关闭 / 进程崩溃 / 重启替换」）、装配细节归一到
      `SessionFactory` 端口（失败发射路径可脱离 Tauri 运行时单测）、重启路径改为静默
      关闭不推 `stopped`（消除 chip 闪断）、崩溃/新会话起点清诊断副本（不留陈旧波浪线））
- [ ] AC3（R3）：Go 文件输入未导入符号产生诊断 → 诊断行 quickfix「Add import」→
      接受后 import 落块、诊断消失
- [x] AC4（R4）：策略设置为 Never 时接受补全不应用附加编辑；Auto 时应用；Ask 弹选择
      （2026-09-20 M4 落地：`LspConfig.importStrategy` + `lspImportStrategy` 拦截层 +
      LspPanel 三态开关；单测 29 + Rust serde 2，全量 4038 passed；真机三态手验待补）
- [ ] AC5（R5）：全链路无语言分支；新增任意遵循 LSP 的 LS（以 builtins 现有 17 种中
      未实测的一种验证）无需改动本任务代码即可获得三通道
- [ ] AC6：门禁全绿（type-check / test:run / lint / eslint / cargo test）；每阶段
      TDD 红绿留痕

## 用户协作验证项（M0，需用户配合）

- 在 Go 项目中实测现有链路：gopls 是否安装/启动、`fmt.` 是否弹出补全、接受后是否
  自动落 import、错误是否显示 squiggle——**实测结果决定 M1 前是否需要先修链路断点**

### R0 诊断记录（2026-09-18，用户实测「自动导包还是不行」）

**根因（三处叠加，均已修）**：

1. **上游分支互斥**（主因）：`@codemirror/lsp-client` 的补全源把「插入文本」与
   「附加编辑」写成互斥分支——`insertTextFormat == 2`（gopls 函数补全的 snippet 形态）
   直接走 snippet 分支并**丢弃** `additionalTextEdits`。→ 以
   `patches/@codemirror__lsp-client@6.2.5.patch` 修正为「捕获 snippet 事务 + 合并附加
   编辑 = 单事务原子应用」。
2. **第一版补丁自身抛错**：`snippet()` 的 apply 返回 void（它内部自行 dispatch），旧补丁
   把 void 当 spec 传入 `view.dispatch(spec, {changes})` → `TypeError`（文本落、import
   不落）。→ 已重写；机制与护栏见 `lspCompletionApplyEdits.test.ts`。
3. **Vite 预打包缓存**：`node_modules/.vite/deps/@codemirror_lsp-client.js` 仍是**未打补丁**
   的上游副本（mtime 早于补丁），即"改了 node_modules 但浏览器仍跑旧代码"。→ 改包后必须
   重启 dev server 或 `npx vite optimize`（已验证重优化后 bundle 含修正实现）。

**应用内确认步骤**：`pnpm tauri dev` → Go 文件输入 `fmt.Pr` → 接受 `Println` →
① 选中项插入函数调用；② **同一次操作**落 `import "fmt"`（一步撤销可整体回退）；
③ DevTools 应打印 `[LSP-probe] completion response: N items, with-additionalTextEdits=M`
（M>0 而 import 仍不落 ⇒ 客户端应用层；M=0 ⇒ 服务端未给附加编辑）。

**顺带核实（未激活）**：`maybeAttachSnippetFallback` 因读取上游 option 上不存在的
`kind` / `insertTextFormat` 而恒早退（自研占位符升级特性当前不生效）；已加
`apply != nil` 让行护栏，避免将来激活时覆盖库的 apply 而重新丢掉 import 编辑。

### R0-b Java 自动导包（2026-09-18 第二轮，用户实测「java 的好像还是有问题」）

**根因：我们自己的一句假能力声明把 import 编辑扣住了。**

`extendedClientCapabilities.resolveAdditionalTextEditsSupport: true`
（`plugin/builtins/java.rs:36`）的含义是「客户端能用 `completionItem/resolve` 取回附加
编辑」。本栈不发 `completionItem/resolve`（Rust transport 只转发请求；
`@codemirror/lsp-client` 无 resolve 支持），于是 jdtls 把 import 编辑**全部推迟**到
resolve —— 而没人去取。

**实测 A/B（本机 jdtls 1.61.0 + JDK 21，未导入 `java.util.List` 的裸工程，
`textDocument/completion` 前缀 `List`）**：

| `resolveAdditionalTextEditsSupport` | 候选数 | 带 `additionalTextEdits` | 说明 |
|---|---|---|---|
| `true`（原状） | 33 | **0** | 全部带 `data`，仅在 `completionItem/resolve` 返回 `import java.awt.List;\n\n` |
| `false`（修正后） | 33 | **33** | import 内联返回，走补全接受原子应用（`insertTextFormat: 2` → 已修的 snippet+edits 合并分支） |

**修正**：删除该声明（`java.rs:38-41`），并把 `java_plugin_advertises_*` 测试改为
「只声明实现了的能力」（`resolveAdditionalTextEditsSupport` 必须**不存在**）。要恢复该
声明，前提是**先真正实现 resolve 通道**（VSCode/Zed 就是这样做的，能顺带拿到被推迟的
`documentation`）。

**验证方式**：改的是 Rust 侧能力载荷 → 需重新 `pnpm tauri dev` **并重启 Java 会话**
（能力在 initialize 时发送）；随后 Java 文件输入 `Lis` → 接受 `List` → import 与调用
同一步落地。

**同类扫描结论（能力声明 vs 实现）**：

| 声明 | 位置 | 实现 | 结论 |
|---|---|---|---|
| `resolveAdditionalTextEditsSupport` | java.rs:36 | ❌ 无 resolve 通道 | **已删**（本 bug 根因） |
| `progressReportProvider` | java.rs:40 | ❌ 全仓无 `language/progressReport` 处理 | **已删**（见 R0-c：实测证明声明它会独占私有通道、标准通道归零 → 导入进度全丢） |
| `classFileContentsSupport` | java.rs:39 | ✅ `java_source_materializer.rs` + `jdtUtils.ts` | 保留 |
| `completionItem.snippetSupport/documentation` | instance.rs:729 | ✅ snippet 分支 + info 面板 | 保留 |
| `workspace.configuration` | instance.rs:732 | ✅ `server_request.rs` 白名单含 `workspace/configuration` | 保留 |

## Notes

- 设计契约见 `design.md`；业界机制见 `research/industry-survey.md`；仓库实证见
  `research/lsp-capability-matrix.md`
- 禁止事项：语言特定逻辑（R5）、无差别透传 server 请求（保持白名单语义）、绕开
  lspStore 单写点直采诊断

### R0-c jdtls 进度通道 + 会话根路径加固（2026-09-18 第三轮，审查后修复）

**① `progressReportProvider` 同理删掉（能力声明 ≠ 实现）**。它是"客户端处理
`language/progressReport` 私有进度通道"的声明。本机 jdtls 1.61.0 + JDK 21 实测
（含 `pom.xml` 的工程 + `updateBuildConfiguration: automatic` 以触发真实导入）：

| `progressReportProvider` | `language/progressReport` | 标准 `$/progress` |
|---|---|---|
| `true`（原状） | **43 条** | **0 条** → jdtls 独占私有通道，本栈零消费 → **Java 导入进度完全不可见** |
| 不声明（修正后） | 0 条 | **36 条**（begin/report/end 各 12；`Synchronizing projects` / `Building` / `Initialize Workspace`，含百分比）→ 走本栈已渲染的进度通道 |

结论：删声明不只是"诚实"，还**直接修好了 Java 导入进度不可见**（顺带收益）。
护栏：`java_plugin_advertises_only_implemented_extended_capabilities` 现在同时禁止这两条声明。

**② 会话根解析的路径穿越加固（红线 8）**。`resolve_session_root` 用
`doc_path.starts_with(project_root)` 判包含，而 `Path::starts_with` 按组件比较但
**不归一化** → `<root>/../other/a.ts` 被误判为"在项目内"。平台差异是关键：
- Unix：`file://` 走 `url::Url::to_file_path()`，点段被 RFC 3986 归一化 → 恰好挡住；
- Windows：`platform::file_url` 只做 percent-decode，**不**归一化 → 逃逸成立；
- 裸路径形态（非 `file://`，`pub(crate)` 调用方可传）：两端都保留 `..` → **macOS 上也能复现**。

修法：新增 `contains_document()`，判定前对两侧 `canonicalize()`（文档不存在时退回父目录，
父目录也不存在才退回词法判定），**返回值仍用原始路径**（不把软链接项目路径改写成真实
路径，保持既有语义）。护栏：`dotdot_document_path_cannot_escape_project_root`（URI + 裸路径
两种形态）、`contains_document_falls_back_to_lexical_when_paths_missing`。

**③ 自动导包 DEV 探针的有界性**（常驻应用内存卫生）：`pendingCompletionIds` 在失败/取消
路径不清、无上界 → 抽出 `rememberPendingCompletionId()`（超 64 淘汰最旧、保新）并在
`catch` 清空；纯函数不变量由测试钉住（走 `send()` 无法构造"响应到达但 id 未登记"）。
