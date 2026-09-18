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

### 1.6 语言差异的归属——数据而非分支（2026-09-18 收敛）

R5 要求"新 LS 接入即自动获得全部能力"，这意味着**语言差异不能出现在通用模块里**。
第一性原理：通用模块（`manager` / `session` / `profile` / `registry`）处理的是
**协议与编排**；"某个服务器怎么找自己的工程、被哪些标记压制、需不需要等文档"是
**服务器特性**，必须以数据形式携带。

本次把两处代码内语言知识数据化（此前是审查记录里的 ⚠️ 项）：

| 原实现（代码内语言知识） | 数据化后 | 引擎侧（无语言名） |
|---|---|---|
| `session/root.rs` 的 `TS_ROOT_MARKERS` 常量 + `is_document_root_scoped(language_id)` 白名单（4 个 TS language id） | `LspPlugin.root_scope: RootScope`（`ProjectScoped` 默认 / `DocumentScoped { markers }`）；TS 家族四个插件声明 `TS_PROJECT_ROOT_MARKERS` | `resolve_session_root(.., &plugin)` 只读 `walk_markers()`；`manager` 的"文档定根必须等文档"判据也改读它 |
| `profile.rs` 的 `marker == "package.json" && has_tsconfig && lang == "javascript"` 特例 | `LspPlugin.detect_suppressed_by: Vec<String>`（javascript 家族声明 `["tsconfig.json"]`）；`DetectionMarker` 结构体随标记携带该规则 | `detect_project_profile_with_markers` 只做一条通用谓词：`!suppressed_by.any(present)` |

**不可合并的细节**（写进数据注释以防回退）：
- `RootScope::DocumentScoped` 自带 markers，**不复用** `root_markers`：后者答"项目用什么
  语言"（typescript 只认 tsconfig.json），前者答"TS/JS 工程根在哪"（需要含
  `package.json` 的目录才能解析 `node_modules/typescript`）。复用会让无 tsconfig 的子包
  被误判回项目根。
- `javascript.detect_suppressed_by` **不含 `jsconfig.json`**：它是 JS 工程配置，压制
  javascript 是语义错误（`jsconfig_does_not_suppress_javascript` 钉住）。

**数据化证明型测试**（新增能力的护栏，数据退化成代码即红）：
`root.rs::document_scoped_markers_come_from_plugin_data`（自定义语言声明 markers 即可
文档定根）、`root.rs::no_document_scan_uses_plugin_markers`、
`profile.rs::custom_plugin_suppression_is_data_not_code`（自定义插件声明压制即生效）、
`profile.rs::suppression_only_applies_when_the_marker_is_present`（反向）、
`typescript_family.rs` 三条数据契约（家族 root_scope 逐字等价 / 压制表内容 / 非 TS 语言
保持项目根）。

**同时清理**：`custom_root_markers()` 与 `detect_project_profile_with_extras()`（全仓零
调用方）删除；`detect_project_profile()` 保留（无调用方但为文档化入口，编译不受影响）。

**剩余例外（不在本次范围，已标注）**：前端 `useLspDefinition.ts`（jdt:// 类文件）、
`lspClientManager.ts`（Java 慢启动超时）是 jdtls **专有扩展**的宿主，属"非标准 LSP 扩展"
而非"语言分支"；如要收敛，应抽象为"服务器扩展能力开关"数据。

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
| **会话边界**（终态 / 新会话起点）| 对应 projectPath 键整体清除（见下方修订） |
| 多项目并发 | diagnosticsByProject 按键隔离（#14 同类门控：跨项目不串） |

**会话边界清诊断（2026-09-18 修订）**：原表述「会话结束 → 清除」在引入
error/stopped 二分后不完整。失效判据改为**会话边界**两侧都清：

| 边界 | 触发状态 | 理由 |
|---|---|---|
| 终态 | `error`（崩溃）/ `stopped`（结束） | 会话不再可能推送；留着就是永久陈旧波浪线（死进程不会澄清） |
| 新会话起点 | `starting` / `initializing` | 重启是**替换**而非结束（后端重启路径刻意不推 `stopped`，避免 chip 闪断），旧会话的诊断事实必须在新会话起点失效，否则"旧已清/新未报"的空窗变成永久残留 |

诊断事件无 languageId → 清除粒度是 projectPath 整键（多语言项目下会连带清掉同项目
其它语言的诊断，等其重新 publish；已知边界，见「不做清单」）。

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

**实现契约（2026-09-18 定稿，替换下方草案）**：不新建并行切片，直接复用既有
`LspSessionState`（`src/features/lsp/store/lspStore.ts`）——它已是「会话状态」的公开
状态接口；另起 `LspSessionHealth{phase: starting|running|failed|stopped}` 会造成同一
事实的第二套词表（`running` vs `ready`、`failed` vs `error`），前端消费面要同时理解
两套。词表以 Rust `LspSessionStatus::as_str()` 为单一事实源：

| Rust 相位 | 状态串 | 语义 |
|---|---|---|
| `Starting` | `starting` | 已 spawn，等 initialize 响应 |
| `Initializing` | `initializing` | initialize 已响应，等 initialized |
| `Ready` | `ready` | 可服务（前端在进度 token 非空时展示为 `indexing`——**前端派生态**，服务端不存在该相位） |
| `Error(msg)` | `error` | 启动异常**或**意外退出（崩溃），带 message + 重试入口 |
| `Stopped` | `stopped` | 会话**结束**（用户停止 / 项目停用） |

**数据源**：Rust 会话生命周期事件 → 前缀常量 `lsp-session-{projectPath}`
（`lsp/types.rs` `LSP_SESSION_EVENT_PREFIX` + 前端镜像 `src/shared/events.ts`；两端
各自钉死字面量的测试互为护栏——红线 5）。

**错误矩阵（2026-09-18 修订：区分「结束 / 崩溃 / 重启」三种退出）**：
| 条件 | 行为 |
|---|---|
| 启动异常（spawn / auto-install / initialize 失败） | `error` + message（chip 显示文案 + 重试按钮，复用 `lspRestartSession` 通道） |
| 进程意外退出（reader 退出且未曾主动关闭） | `error` + `{server} exited unexpectedly`（AC2 崩溃可观测） |
| Neeko 主动关闭（停止 / 项目停用） | **先落终态**再推 `stopped`——顺序不可交换，否则 reader 退出会被判成崩溃（"关闭后闪错误"） |
| 重启（Restart / Restart All / 崩溃重试） | 关闭阶段**静默**（不推 `stopped`）→ 序列 `…→starting`：重启是**替换**而非结束，宣告终态会让 chip 被过滤后又被拉起（闪断，jdtls 可达数十秒） |
| reader 线程 panic | 兜底按崩溃发 `error`，panic 载荷写日志（应用无全局 panic hook，载荷丢弃则打包后无处可查） |
| 重复事件 | 幂等：终态吸收，`close` / `on_reader_exit` 仅首次返回 true → 不重复发事件 |

**实现要点（单一真相）**：
- `lsp/session/lifecycle.rs::Lifecycle` = 会话状态**唯一真相**：reader 线程与关闭路径
  是写者，快照 / 存活判定 / 事件发射是读者。此前是 `LspSession.status`（构造后永不
  更新的字段）+ `closing: AtomicBool`（第二套判定）+ `snapshot()` 轮询
  `JoinHandle::is_finished()`（第三套反推）三份表示互相补偿，且**无法区分**两种
  "reader 已结束"（优雅关闭 vs 进程崩溃）。
- `lsp/session_factory.rs::SessionFactory` = 会话装配端口（DIP）：manager 只编排
  （gate → 复用判定 → 装配 → 文档重放 → 登记 → 事件），transport / session 构造由
  注入实现负责。收益：① AC2 的失败发射路径可在**无 Tauri 运行时**下单测（`AppHandle`
  无法常驻 `#[cfg(test)]`）；② `transport.rs` 承诺的「WebSocket 替换 IPC 而不改会话
  逻辑」有了实际替换点。
- `lsp/session/testing.rs` = 会话域测试夹具（桩会话 + recording transport），
  instance / manager 两个测试模块共用，取代此前各自维护的 18 字段字面量副本。

**测试点**：`lifecycle.rs` 相位机单测（推进 / 终态吸收 / 崩溃幂等 / `Error` 归一 /
`Indexing` 归一）；`instance.rs`（相位与事件同源、reader 退出三态、快照三态、
panic 载荷可读）；`manager.rs`（关闭语义 宣告 vs 静默、装配失败发 `error`、装配成功
登记）；前端 store（幂等 + 会话边界清诊断）；status-bar chip 三态（busy / error+重试 /
ready）。

<details>
<summary>原草案（已由上方实现契约替换，保留决策痕迹）</summary>

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

</details>

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
- ❌ 诊断按**语言**粒度失效（需 `publishDiagnostics` 事件带 languageId：传输层当前
  只有 `push_diagnostics(project_path, uri, diagnostics)`，无 languageId。多语言项目下
  一条语言的会话边界会清掉同项目其它语言的诊断，等其重新 publish 才恢复——已知边界，
  根治留扩展点）
- ❌ 全局 panic hook / 崩溃上报（M2 只在 reader 线程 catch_unwind 内落日志）

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| lsp-client 补全接受的 additionalTextEdits 应用在真实 gopls 下有位置转换 bug | **已定案（2026-09-18）**：根因是上游把 snippet 与附加编辑写成互斥分支（`insertTextFormat == 2` 时丢弃 `additionalTextEdits`），非位置转换 bug。修正 = pnpm patch 合并进同一事务；第一版补丁把 `snippet()` 的 void 返回值当 spec 传给 `dispatch` 而抛 TypeError，已重写并加测试护栏；另发现 Vite 预打包缓存（`node_modules/.vite`）会让 node_modules 改动**不进浏览器**——改包后必须重启 dev server 或 `npx vite optimize` |
| node/jsdom 分拆后 lspStore 测试环境归属 | diagnostics 订阅用 mock 事件，纯逻辑可 node 环境 |
| 灯泡 UI 与 CM hover/tooltip 体系冲突 | M3 实现期仅做 DiagnosticsPanel 行内入口（不进 CM 视图），规避 tooltip 竞态 |
| 诊断事件高频推送导致 store 抖动 | setProjectDiagnostics 按 uri 整体替换（幂等），面板渲染走既有 memo 模式 |
