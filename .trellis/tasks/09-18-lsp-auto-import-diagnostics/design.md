# 设计：编辑器 LSP 自动导入与诊断提示体系

> 依据：PRD（../prd.md）、能力盘点（research/lsp-capability-matrix.md，下称「矩阵」）、
> 业界调研（research/industry-survey.md）。原则：第一性原理分析；实现遵循高内聚、
> 低耦合、高可扩展。

---

## 1. 第一性原理

### 1.1 知识归属——谁有权回答「这个标识符属于哪个包」

输入 `fmt.Println()` 与「能编译」之间缺的信息 = **标识符 → 包路径的绑定**。该绑定要求
全仓符号索引（含 GOPATH/依赖树），编辑器没有也不该有这份索引——它是语言服务器的核心
资产（gopls 的 unimported completions、jdt.ls 的补全、tsserver 的 auto-import 全部
由 server 计算）。诊断同理：`undefined: X` 的判定需要类型系统。

**推论 D1（架构铁律）**：Neeko 不实现任何语言逻辑。编辑器职责 = LSP 传输完备性 +
原子应用 + 呈现 + 交互策略。语言知识边界一旦越过（如内建 Go 包名表），可扩展性根基
即被破坏——新 LS 永远拿不到手写逻辑覆盖的能力。

### 1.2 意图的形态——三条通道互为冗余

用户到达「正确代码」有三条独立通道，缺任何一条就少一条路径（业界共识，见 industry-survey §1）：

| 通道 | 方向 | 载荷 | 时机 |
|---|---|---|---|
| A 补全接受 | 客户端拉 | CompletionItem.additionalTextEdits | 输入中，接受补全时 |
| B 诊断推送 | 服务器推 | publishDiagnostics | 编辑中异步 |
| C 修正回路 | 客户端拉 + 服务器推 | codeAction → applyEdit | 诊断出现后 |

**推论 D2**：通道 A 的实现主体已在包内（lsp-client index.js:969-971 原子应用
additionalTextEdits）——**禁止旁路**：任何「在客户端二次计算 import 位置」的代码都是
对 D1 的违反。

### 1.3 状态归属——诊断数据的单写点

诊断数据有两个消费面：CM squiggle 渲染（lsp-client 内部，已运行）与 Problems 列表
（本任务新增）。两者必须同源，否则出现「波浪线在、列表没有」（状态管理 spec §12 同类
病根：同一事实两个表示）。

**推论 D3（诊断单写点）**：lspStore 直采 Tauri 诊断事件
（`lsp-diagnostics-{projectPath}`，events.ts:31）建立 uri 键控的诊断状态；CM 的
squiggle 由 lsp-client 独立消费同一事件流（现状不动）。不经过 lspStore 转发——
避免在传输层与呈现层之间再加一跳。

**勘误（2026-09-18 实测后修正 D3 的推理）**：原文写「同源 ⇒ 天然一致」是**错**的。
同源只保证**初始**一致，不保证**后续**一致：Problems 的副本活在 lspStore（生命周期 =
会话），波浪线的副本活在 CM 状态里（生命周期 = 一次配置代）。两者会被不同操作影响，
必须由「单一权威副本 + **可重建的投影**」保证一致，而不是「两个消费者各存一份」。

### M1 真实根因（2026-09-18 定稿）

```
LSP 推送 → transport 补 JSON-RPC 信封 → lsp-client serverDiagnostics() 映射坐标
        → dispatch setDiagnostics  → lint 渲染扩展经 appendConfig 惰性安装（波浪线出现）
        ↓
宿主 @uiw/react-codemirror 见 extensions 身份变化 → dispatch StateEffect.reconfigure
        （useCodeMirror.js:141-148）
        ↓
@codemirror/state: reconfigure 整体替换 base（:2614-2621）→ appendConfig 的追加结果被丢弃
        ↓
lintState 字段消失 → 波浪线清零；lspStore 那份诊断仍在 → Problems 正常、波浪线没了
```

触发条件：`extensions` 身份随活状态抖动（`saveKeymap` ← `currentContent`/`isDirty`；
`lspKeymap` ← 每次渲染新建的 `tab` 对象）→ **每次按键都重建整个扩展世界**。
「输入时闪烁」= 按键清零 → 约 500ms 后 autoSync + 服务端重推 → 再现；
「保存后不恢复」= 保存清零后不再有新推送，无人重建投影。

### M1 三条不变量（实现约束）

| 编号 | 不变量 | 落地 |
|---|---|---|
| **I1 权威副本唯一** | 诊断事实（server 坐标）唯一写在 lspStore；Problems 面板是它的投影 | `lsp/store/lspStore.ts` |
| **I2 投影可重建** | 编辑器波浪线是投影，配置重建后必须自愈 | 新增 `lsp/hooks/lspDiagnosticsProjection.ts`：`diagnosticsMirror`（StateField，位于 base 故 reconfigure 存活）+ `reconciler`（ViewPlugin，仅 `StateEffect.reconfigure` 且镜像非空时微任务重放 `setDiagnostics`） |
| **I3 配置纯净** | 传给 `<CodeMirror>` 的 `extensions` 身份只能由配置输入决定，禁止依赖活文档/活 tab 对象 | `useEditorSave`（ref 化内容与脏标记）、`useLspNavigation`（派生 `lspDocumentUri` 标量）、`useCmdClickGoToDefinition`（显式标量入参） |

**为什么不让投影直接从 store 重算（原「纯派生」方案被否）**：server 坐标 → CM 位置的映射
与 version 门控是 lsp-client 的核心职责（D1/D2 禁止旁路与二次计算），照抄一遍必然与上游
漂移。本设计让 lsp-client 继续负责映射，宿主只让**映射结果可存活、可重建**。

**渲染链自组装的边界**：`serverDiagnostics()` 只产生 `setDiagnostics` 事务，
`setDiagnostics` 经 `maybeEnableLint` 自动追加渲染扩展（`lintState.provide` 自带
wavy decorations + hover tooltip，@codemirror/lint 源码 :127/:176/:891 实证），
**无需也不应显式挂 `linter()`**（挂空 source 会在 idle 轮询时清空推送诊断）——
该结论仍然成立，原「勘误」的错误只在于由此推出「渲染侧无缺口」：**惰性安装的能力
在宿主重建配置时会消失**，渲染侧缺的不是渲染器，而是**投影的存续性**。

**判据补充（实证）**：不能用 `Transaction.reconfigured` 判「base 被替换」——它只是
`startState.config != state.config`，对 `StateEffect.appendConfig` 同样为 true，
会让首次推送与每次重放自己触发自己。必须只认 `StateEffect.reconfigure`。
也不能用 `diagnosticCount` 与镜像长度比对：它是 lint **合并后**的 range 数。

### 1.4 信任边界——server→client 请求的白名单

`server_request.rs` 对未知 server 请求回 MethodNotFound 是**既有的安全语义**（LS 输入
是不可信输入）。新增 `workspace/applyEdit` 转发必须进白名单显式处理，而不是放开透传。

**推论 D4**：applyEdit 转发 = 白名单新增一项 + 转发到前端（Tauri 事件）+ 前端原子应用
+ 回 Response。codeAction 请求本身是客户端发起的普通 request（走既有 lspRequest 面）。

### 1.5 交互策略是唯一允许的「产品逻辑」

Ask/Auto/Never（IDEA 三态，industry-survey §4）作用于「接受补全时是否应用附加编辑」，
是传输之上的 UI 策略，不触碰传输契约。

---

## 2. 分阶段契约（M1 → M4）

> 顺序依据：M1（诊断可视化）独立可交付且是 AC 的感知基础；M2（健康度）让用户自答
> 「为什么没提示」；M0 用户协作验证贯穿（见 implement.md）。M3 依赖 M1 的诊断 UI 承载
> 灯泡入口。M4 纯策略层最后。

### M1 诊断可视化闭环（R1 / AC1）

**签名**：
```ts
// src/features/lsp/store/lspStore.ts（或 lspStore 既有结构内新增切片）
interface LspDiagnosticsState {
  /** projectPath -> uri -> 诊断数组（uri 为 LS 报告的 textDocument.uri） */
  diagnosticsByProject: Record<string, Record<string, LspDiagnostic[]>>;
}
setProjectDiagnostics(projectPath: string, uri: string, diagnostics: LspDiagnostic[]): void;
```

**数据流**：lspStore 注册 `listen(\`${LSP_DIAG_EVENT_PREFIX}${projectPath}\`)`（注册
时机 = 有活跃 LSP 会话的项目；释放 = 会话结束，对齐 idleRefCountedCache 的引用计数
思路）。事件 payload `{ uri, diagnostics }` → `setProjectDiagnostics`（**整体替换**
该 uri 的诊断，publishDiagnostics 语义就是全量推送）。

**DiagnosticsPanel 接线**：
- 数据：`useLspDiagnostics(projectPath, fileName/uri)` 从 lspStore 选择
- 挂载判定标准（实现期三选一，取最小侵入）：(a) dock 既有面板体系内新增 Problems
  面板；(b) 编辑器组底部可折叠条；(c) status-bar 弹层。判定依据：与现有「终端/调试」
  面板同类 = dock；仅计数 = status-bar。**禁止**新建第三种面板机制
- 空态：无诊断显示空态文案（组件 :10-12 已有）

**错误矩阵**：
| 条件 | 行为 |
|---|---|
| 事件 payload 解析失败 | 丢弃 + console.warn（单事件损坏不污染状态） |
| LS 推送空 diagnostics 数组 | 整体替换为空（清空该 uri，规范语义） |
| 会话结束 / 项目移除 | 对应 projectPath 键整体清除 |
| 多项目并发 | diagnosticsByProject 按键隔离（#14 同类门控：跨项目不串） |

**投影接线（2026-09-18 修正）**：
- 事实层（本任务新增的 store 切片）不变：`diagnosticsByProject` 是**权威副本**（I1）。
- 投影层新增 `lsp/hooks/lspDiagnosticsProjection.ts`（I2）：`diagnosticsMirror` +
  `reconciler`，由 `useEditorExtensions` 按**稳定段**装配（不随 `lspClientExt`
  挂载/释放起落）——详见上文「M1 三条不变量」与「M1 真实根因」。
- 装配约束（I3）：`extensions` 身份只由配置输入决定；活文档/活 tab 对象禁止进入依赖。

**已知边界（不修，留扩展点）**：同一 uri 两个编辑器（split 同文件）时，
`@codemirror/lsp-client` 的 `DefaultWorkspace` 是单视图模型（`lspClientManager` 的
「摘旧再登记」补丁即为此），只有 owner 视图收到推送 → 非 owner 视图无波浪线。
需 store 驱动的共享投影才能解决，属后续任务。

**测试点**：store 单测（替换语义/清空/跨项目隔离/解析容错）；面板组件测试（分组渲染
/跳转回调/空态）；订阅生命周期测试（acquire/release 对称）；**投影单测**
（`lspDiagnosticsProjection.test.ts`：推送渲染 / reconfigure 后自愈 / 镜像位置映射与
塌缩丢弃 / 空镜像不重放 / 连续重配置合并 / 销毁后不抛）；**身份稳定回归**
（`saveKeymap`、`lspKeymap` 引用不随内容与 `isDirty` 变化）。

### M2 会话健康度可观测（R2 / AC2）

**签名**：
```ts
// lspStore（或独立 sessionHealth 切片）
type LspSessionPhase = 'starting' | 'running' | 'failed' | 'stopped';
interface LspSessionHealth { phase: LspSessionPhase; languageId: string; error?: string }
setSessionHealth(projectPath: string, languageId: string, health: LspSessionHealth): void;
```

**数据源**：Rust 侧会话生命周期钩子（session/instance 启动成功/失败/退出）→ 复用
`lsp-progress-{projectPath}` 事件前缀或新增 `lsp-health-{projectPath}`（实现期按
diag_bus 既有模式二选一，事件名常量化进 events.ts——红线 5）。前端 status-bar item
（registry 机制已有）展示语言图标 + phase。

**错误矩阵**：启动异常 → failed + error 文案 + 重试入口（重试 = 既有 installer/probe
链路）；进程退出 → stopped；重复事件幂等（同 phase 重放不闪烁）。

**测试点**：Rust 钩子触发矩阵单测；前端 store 幂等单测；status-bar item 组件测试。

### M3 codeAction 通道（R3 / AC3）

**签名**：
```ts
// Rust：server_request.rs 白名单新增
"workspace/applyEdit" => // 转发 Tauri 事件 `lsp-apply-edit-{projectPath}`，回 Response ok
                         // （LSP 语义：客户端应答 applied；失败经 Response error 上报）

// 前端：lsp 域新增 codeAction 封装（走既有 lspRequest 面）
requestCodeActions(projectPath, languageId, uri, range, diagnostics): Promise<CodeAction[]>
applyCodeAction(action: CodeAction): Promise<void>  // 含 edit 的原子应用；命令类走既有命令通道
```

**灯泡入口**：诊断行 hover/点击 → requestCodeActions（kind 含 quickfix）→ 呈现动作
列表 → applyCodeAction。位置：M1 的 DiagnosticsPanel 行内（数据同源），编辑器内
CM gutter/行内灯泡为可选增强（实现期评估，不做承诺）。

**错误矩阵**：
| 条件 | 行为 |
|---|---|
| codeAction 请求超时/失败 | 灯泡点击显示失败 note（复用 lspRequestTimeoutMessage 模式） |
| applyEdit 应用的 uri 不在打开集合 | 丢弃 + warn（不静默开文件——首版语义，后续按需扩展） |
| applyEdit 解析失败 | Response error 回 server + 前端 note |
| 多动作并发应用 | 串行队列（CM dispatch 原子性依赖事务顺序） |

**测试点**：Rust 白名单转发单测（含 MethodNotFound 兜底回归）；前端 applyEdit 应用
原子性测试（多 edit 事务）；灯泡组件交互测试；codeAction mock 链路测试。

### M4 导入策略三态（R4 / AC4）

**签名**：设置项 `editor.lsp.importStrategy: 'auto' | 'ask' | 'never'`（settings 域
既有模式）。作用点 = 补全接受前拦截：`auto` 放行；`never` 剥离
`additionalTextEdits` 后交给 CM；`ask` 列出附加编辑摘要（import 行预览）确认后放行。

**实现位置约束**：拦截点在 lsp 域的补全包装层（`lspCompletionInfoRenderer` 的
`createThemedCompletionSource` 返回处——它是所有补全项的必经之路，D2 禁止旁路），
**不改 lsp-client 包**。

**测试点**：三态单元测试（同一补全项在三态下的 option.apply 行为差异）；设置持久化。

---

## 3. 不做清单（YAGNI 红线）

- ❌ 任何语言特定导入/诊断逻辑（D1）
- ❌ server 请求无差别透传（保持白名单语义，D4）
- ❌ 诊断状态经 lspStore 转发后再喂给 CM（D3：双呈现直接共享事件源，不加转发层；
  宿主只做「让映射结果可存活、可重建」，见 I2）
- ❌ 在编辑器上再挂第二套 `linter()`：投影的 reconfigure 重放会与该 linter 的结果
  互相覆盖（诊断装饰的唯一生产者必须是 LSP 推送）
- ❌ rename / organizeImports / refactoring 等 source.* 命令全量接入（M3 只做
  quickfix + applyEdit 传输；source 操作留扩展点不做承诺）
- ❌ 自研补全 UI / 诊断 UI 替换 lsp-client 内建渲染（只做包装与接线）

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| lsp-client 补全接受的 additionalTextEdits 应用在真实 gopls 下有位置转换 bug | M0 实测是第一优先级；发现即上游 issue + 客户端兜底（本任务内记录不内修包） |
| node/jsdom 分拆后 lspStore 测试环境归属 | diagnostics 订阅用 mock 事件，纯逻辑可 node 环境 |
| 灯泡 UI 与 CM hover/tooltip 体系冲突 | M3 实现期仅做 DiagnosticsPanel 行内入口（不进 CM 视图），规避 tooltip 竞态 |
| 诊断事件高频推送导致 store 抖动 | setProjectDiagnostics 按 uri 整体替换（幂等），面板渲染走既有 memo 模式 |
