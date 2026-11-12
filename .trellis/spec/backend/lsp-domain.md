# LSP 域（语言服务器协议）

> `src-tauri/src/lsp/` 与 `src/features/lsp/`、`src/features/editor/` 相关装配的分层、
> 不变量与踩过的坑。任务源：`09-18-lsp-auto-import-diagnostics`（M1-M3 + F1-F7）。
>
> 与[质量指南](./quality-guidelines.md)的红线互补：本文件只记录 LSP 域**特有**约定，
> 通用规则不在此重复。

---

## 1. 三通道模型（D1/D2：Neeko 不实现语言逻辑）

输入 `fmt.Println()` 与"能编译"之间缺的信息 = **标识符 → 包路径绑定**（全仓符号索引），
只有语言服务器有权回答。编辑器职责 = 传输完备性 + 原子应用 + 呈现 + 交互策略。

| 通道 | 方向 | 载荷 | 时机 |
|---|---|---|---|
| A 补全接受 | 客户端拉 | `CompletionItem.additionalTextEdits`（含 snippet 合并单事务） | 输入中接受补全时 |
| B 诊断推送 | 服务器推 | `publishDiagnostics` → `lsp-diagnostics-{projectPath}` | 编辑中异步 |
| C 修正回路 | 客户端拉 + 服务器推 | `textDocument/codeAction` → `workspace/applyEdit` | 诊断出现后 |

**铁律**：禁止包名表、正则匹配、按语言分支 UI；禁止在客户端二次计算 import 位置
（D2 禁止旁路，`additionalTextEdits` 由 lsp-client 补丁原子应用）。语言差异一律数据化
为 `LspPlugin` 字段（`root_scope` / `detect_suppressed_by`，见 design §1.6），通用模块
出现 `language_id == "xxx"` 即 Block。

---

## 场景：workspace/applyEdit 跨层转发（C 通道后半段）

### 1. Scope / Trigger

- Trigger：server→client 的 `workspace/applyEdit` 必须到达已打开的编辑器并单事务落地，
  且**绝不能让服务端卡住**。`server_request.rs` 对未知请求回 `MethodNotFound` 是既有
  安全语义，新增方法必须进白名单显式处理（D4）。

### 2. Signatures

```rust
// server_request.rs
pub struct ServerRequestCtx<'a> {
    pub workspace_folder_uri: Option<&'a str>,
    pub project_path: &'a str,
    pub language_id: &'a str,
    pub transport: &'a dyn LspTransport,
}
pub fn respond_to_server_request(req: &Request, ctx: &ServerRequestCtx<'_>) -> Response
// transport.rs
fn push_apply_edit(&self, project_path: &str, language_id: &str, edit: &serde_json::Value)
```

```ts
// codeAction.ts / lspWorkspaceEdit.ts
requestCodeActions(projectPath, languageId, uri, range, diagnostics): Promise<LspCodeAction[]>
applyCodeAction(uri: string, action: LspCodeAction, resolveView = resolveEditorViewFromUri): boolean
applyWorkspaceEdit(edit: LspWorkspaceEdit, uri: string, resolveView: EditorViewResolver): boolean
```

### 3. Contracts

1. 白名单契约：`workspace/applyEdit` 转发 Tauri 事件 `lsp-apply-edit-{projectPath}`，
   载荷 `{ languageId, edit }`（`edit` 为原始 `WorkspaceEdit`，后端不解析）；未知方法
   仍 `MethodNotFound`，禁止无差别透传。
2. 乐观应答契约：后端回 `{ applied: true }` 即返，不等前端 ack（等 ack 需新命令 + 关联
   id + 超时，前端不应答即重演"服务端卡住"——本模块存在的理由）。代价是极端情况下
   applied 为真而编辑未落地，优于整个会话停滞。
3. 分流契约：前端按 `languageId` 分流（同 project 多 transport 各收各的），逐目标 uri
   一次 `dispatch`（单事务、单步撤销、同一份起始文档解析坐标）。
4. 范围契约：只作用已打开的编辑器页；未打开 → `warn + false`，不引入写盘路径。
5. 事件名契约：`LSP_APPLY_EDIT_EVENT_PREFIX` 两端常量化（`lsp/types.rs` ↔
   `shared/events.ts`），字面量互锁测试。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| `workspace/applyEdit` 到达 | 转发事件 + 回 `applied:true`（畸形缺 `edit` 也回真，转发 `Null`） |
| 未知 server 请求 | `MethodNotFound`（兜底回归测试钉死） |
| codeAction 请求失败/返回 null | 降级 `[]`（诊断行无灯泡，不弹错） |
| command-only 动作（无 `edit`）/ `source.*` | 不进 quickfix 菜单（`groupQuickFixActions` 只列带 `edit` 且非 `source.*`） |
| apply 目标未打开 / 零有效 edit | `false`，菜单保持打开让用户看到 |
| 坐标越界（诊断滞后） | `lspPositionToOffset` 夹紧（行超取末行、列超取行尾），不抛错打断整批 |

### 5. Good/Base/Bad Cases

- Good：Go 未导入符号诊断 → 灯泡"Add import" → import 落块、诊断消失。
- Base：服务器零动作 → 菜单仍有 ✨ Fix / ✨ Explain（B1：agent 自己改文件）。
- Bad：前端等 ack 后再回服务端 → 前端崩溃/未订阅时服务端永久挂起。

### 6. Tests Required

- `server_request.rs`：转发原样 + 乐观应答 + 畸形 + `MethodNotFound` 兜底。
- `lspWorkspaceEdit.test.ts`：多 edit 单事务、越界夹紧、未打开 `false`。
- `codeAction.test.ts`：失败降级 `[]`、分组过滤、桩 resolver 转发。
- `lspCompletionProbe` / transport：订阅分流、注销对称（`safeUnlisten`）。

### 7. Wrong vs Correct

```rust
// Wrong：无差别透传 server 请求
_ => forward_everything(req)
// Correct：白名单显式项
"workspace/applyEdit" => { transport.push_apply_edit(...); Response::new_ok(...) }
_ => Response::new_error(req.id.clone(), ErrorCode::MethodNotFound as i32, ...),
```

```ts
// Wrong：lsp api 直引 editor 具体实现
import { resolveEditorViewFromUri } from '@/features/editor/api/editorViews';
applyCodeAction(uri, action); // 硬依赖，双向耦合
// Correct：注入 resolver（默认参数保持零改动）
applyCodeAction(uri, action, resolveView = resolveEditorViewFromUri);
```

---

## 2. 诊断单写点（D3：权威副本 + 可重建投影）

- 事实层：`lspStore.diagnosticsByProject[projectPath][uri]` 是唯一权威（publish 语义 =
  整体替换；会话边界两侧都清：终态 `error/stopped` + 新会话起点 `starting/initializing`）。
- 投影层：CM 波浪线是投影（`lspDiagnosticsProjection` 镜像 + reconfigure 重放），配置
  重建后自愈；禁止挂第二套 `linter()`（会与重放互相覆盖）。
- 面板与编辑器菜单共用 `groupQuickFixActions`，两端结构不漂移；诊断取 store 原始项
  （保留 `data`，部分服务器靠它匹配 quickfix），不读 CM lint state。

### 设计决策：波浪线模型（客户端不猜新鲜度，但用内容锚定挡陈旧坐标）

**Context**：编辑时旧错误波浪线不跟随错误代码位置——rust-analyzer 1.97.1 把「当前
版本号」盖在「旧分析坐标」上重发（文档版本钟 ≠ 分析新鲜钟，flycheck 缓存）。曾用
三层启发式防御（`keepSyntaxLayerOnly` 语法层过滤 / 内容锚定 / 越界检查），但客户端在
信息论上**无法判定**「坐标是新鲜还是陈旧」，任何启发式都既误杀又漏网（2026-09-22
实证：语法错误时隐藏全部语义诊断、跨行/无 token 诊断 fail-open 放行）。

**Options Considered**：
1. 严格化锚定 + 批级决策 —— 仍是猜测，跨行/无 token 诊断永远无法可靠锚定。
2. 对齐 VS Code：`DiagnosticCollection.set` 零过滤整批替换，信任服务器靠重推自愈。
   —— **试行失败**（2026-09-22 用户复测）：rust-analyzer 语义诊断重推慢（flycheck
   缓存），"短暂画错自愈"在本栈不成立；陈旧坐标被整批应用，把 lint/mirror 已**跟随
   正确**的旧波浪线拽回旧行（用户实测「编辑后旧波浪线跑到别的行」）。
3. settle 延迟窗口 —— 已试删，语义波浪线滞后。

**Decision**：**内容锚定（恢复）+ 逐条判定 + 混装批合并**。内容锚定是信息论上
**可判定**的唯一判据：点名 token 的诊断（E0425/E0433 的 message 含
`` `int32` ``）映射到当前文本切片，不含该 token → 坐标与文本不符 → 陈旧。**不做**
的信息论上不可能的判断（无 token / 跨行 / 映射失败的 fail-open 放行，靠服务器下一次
新鲜推送纠正）。**批级演进**：十七轮曾「任一条陈旧 → 整批拒绝」，但混装批
（陈旧 E0425 + 新鲜 syntax-error）会连带拒绝新鲜的 syntax-error（缺分号波浪线不显示）
——十八轮改为**逐条判定 + 合并**。

```ts
// applyFiltered 流程（2026-09-22 十八轮逐条合并修正）
// ① incoming.length === 0 → 清空（整体替换语义）
// ② 无 file?.doc        → 委托内层（版本门在其中）
// ③ isFresh(d) = rangeFitsDocument(doc, d.range) && anchorFitsCurrentText(view, d)  // 逐条
// ④ fresh = incoming.filter(isFresh)；stale = incoming.filter(!isFresh)
// ⑤ stale.length === 0 → inner(client, params)           // 全部新鲜：整批应用
// ⑥ fresh.length === 0 → return true                     // 全部陈旧：保留 lint 旧线
// ⑦ 混合：fresh 原样 + stale 用 lint 已跟随位置重建坐标后一并 inner
//    （lintPositionsByMessage 按 message 读 lint 当前渲染位置，plugin.toPosition
//     转回 LSP；lint 里也没有 → 丢弃，避免旧坐标画错位）
```

**保留**：内层 lsp-client 版本门（防「旧版本号+旧坐标」真实违规）；lint
`map(tr.changes)` 文本跟随（CodeMirror 天然行为，编辑时旧线随文本走——比 VS Code 更优）。

**删除**（clean cutover，grep 零残留）：`keepSyntaxLayerOnly`（语法错误不再隐藏语义
诊断）、`syntax_error_codes` 全链路（`LspPlugin` 字段+builder、`LspExtensionMapEntry`
DTO、registry 映射、rust builtin 声明、前端 `lspApi`/`languageMap`）。

**行为契约**：陈旧坐标（新版本号+旧坐标）由内容锚定拒绝，旧波浪线跟随文本不被拽回；
新鲜推送到达即纠正。语义诊断不再被语法错误隐藏（错误始终可见）。**逐条合并（18 轮）**：
混装批里新鲜诊断应用、陈旧诊断用 lint 已跟随位置重建后一并应用——既不连带拒绝新鲜的
syntax-error（缺分号必须显示），也不让陈旧 E0425 覆盖跟随正确的位置。**禁止**整批拒绝
（会连带拒新鲜条）或纯子集应用（会隐式清除被过滤诊断）。禁止重新引入 settle 延迟 /
指纹去重 / 语法层过滤等启发式。

**护栏测试**：`lspDiagnosticsMapping.test.ts` 17 用例——版本门/越界保留语义钉死；
「陈旧推送被锚定拒绝 → 跟随旧线不被拽回 → 新鲜推送应用到位」完整序列
（`edit_insert_line_then_stale_rejected_then_fresh_applies`）；「陈旧越界 E0425 +
新鲜 syntax-error 混装批 → 逐条合并 → E0425 保留 lint 跟随位置**且** syntax 点显示」
用户现场回归；未同步编辑窗口内陈旧重定位反解 syncedDoc、往返恒等不偏移；语法+语义
同批都应用（不隐藏语义）。

## 3. 重构台账（F1-F7，后来者勿回退）

| 项 | 约定 |
|---|---|
| F1 | `applyCodeAction` 只认注入的 `EditorViewResolver`；`runAiQuickFixAction` 走 `aiActionRegistry` 端口 |
| F2 | 终端创建（配额 `MAX_TERMINAL_TABS`/ID/排序）只住 `terminal/api/taskTerminal.ts`，editor 只调端口 |
| F3 | `aiActionRegistry` 与 `editorViews` 同构引用计数（`{handler/view, count}`），注销归零才删 |
| F5/F7 | `lspQuickFix.ts` 只装配；渲染（`quickFixMenuRender`）vs 派发（`quickFixMenuActions`）vs popup vs gutter 单向依赖；探针纯函数住 `lspCompletionProbe.ts` |
| 行数 | 非测试源码 <300 行；`lsp/types.rs:383` 含约 117 行内联测试（净源码约 266 行），属已知豁免；`instance.rs` 存量胖（1515 行 = 非测试源码 ~919 + 内联测试；10-10-lsp-failure-diagnostics-ownership 净 +150：诊断句柄接线 / 握手 drain / 内联证据与其用例），不扩范围 |
| F4 | shell 选择在执行层（`platform/shell_launch` 的 `cmd /c` vs `sh -c`），拼装层只做 sh 转义并显式委托注释 |

## 4. 导入策略三态（M4：R4/AC4，传输之上的唯一产品逻辑）

- 设置：`LspConfig.importStrategy: 'auto' | 'ask' | 'never'`（默认 `auto`；前后端缺字段
  回落 auto，`#[serde(default)]` 向后兼容）；读写走 settings 既有通道
 （`useAppConfig.mergeLspConfig` 单写点 + `patchLsp` 持久化 + `LspPanel` ToggleGroup）。
- 拦截点：`createThemedCompletionSource` 返回处逐项变换 `apply`（所有补全项必经之路，
  D2 禁止旁路，不改补丁包）：`auto` no-op；`never` 换只插入（单事务单 spec，不重算
  坐标与文本）+ 跳过 resolve 预热与选中解析；`ask` 有编辑弹确认（import 首行摘要预览，
  确认放行 / 取消只插入 / 通道故障 fail-open 到 auto），无编辑不打扰。
- 模块：`lsp/api/lspImportStrategy.ts`（纯函数 + 模块级同步缓存，`languageMap.customExtMap`
  同款模式）；CM6 option 无 `additionalTextEdits` 字段是既定事实，策略层只认"携带编辑"
  的 option 形态，禁止回头解析 LSP 载荷。
- 测试：三态行为差异 + 持久化 roundtrip + 缺字段回落 auto。

## 5. Problems 大项目性能（P1-P4：09-20-problems-perf + 分组增量）

> 触发：jdtls 初次构建短时对数百文件逐个 `publishDiagnostics`，N 次直写 → N 次订阅通知
> → 面板 N 次全量重投影（当时的 `buildGroups`，现为 `utils/diagnosticGroups.
> orderDiagnosticFileGroups`）+ 全行挂载，千行级卡顿。

- **P1 发布合并**：`subscribeToProject` 内 `pendingDiag` 待处理表 + `queueMicrotask` 单次
  flush；写路径收敛到 store action `setProjectDiagnosticsBatch(projectPath, entries)`
  （`patchDiagnosticsByProject` 是诊断切片唯一展开逻辑，单条 `setProjectDiagnostics` 与
  batch 共用 —— D3 单写点只此一份）。关键安全分支：会话边界 `pendingDiag.clear()` 防陈旧
  microtask 回写；卸载兜底同步 `flushPendingDiag()` 防丢尾。
- **P2 默认折叠**：`DiagnosticsPanel` 文件组数 > `COLLAPSED_GROUP_THRESHOLD`（20）默认折叠，
  折叠组零行渲染；`languageId` 按组算一次。`toggleCollapsed` 须按当前展开态翻转
  （`!(prev[uri] ?? defaultCollapsed)`）—— 默认折叠下首次点击必须展开。
- **P3 行 memo**：`DiagnosticRow`（`React.memo`）props 全稳定引用；`onJump` 在 Panel 层
  `useCallback` 稳定，上游 `ProblemsPanel.handleJump` deps `[activeProject, projectId]`
  （仅切项目变）。**契约**：无关 uri 的诊断对象引用必须不变（P1 合并保证），否则 memo
  浅比较失效。
- 护栏测试：`lspDiagnosticsBurst.test.ts`（200 uri ≤3 通知 / 同 uri 覆盖 / 卸载 flush 兜底 /
  会话边界清缓冲）、`DiagnosticsPanel.perf.test.tsx`（30 组折叠 / 20 组展开 / 无关 publish
  行不重渲染）。
- **分组增量契约（防回退）**：未变 uri 的数组引用不变 ⇒ 该分组既不重排也不重渲染
  （`DiagnosticGroup` / `DiagnosticGroupHeader` 的 memo，行再叠 `DiagnosticRow` 的 memo）。
  落点：`DiagnosticsPanel.perf.test.tsx`「does not re-render untouched group headers」。
- **列表投影每次 flush 重算（决策，非债务）**：`orderDiagnosticFileGroups` 每次 flush 重跑
  标签计算 + O(G log G) 排序（G = 文件组数）。实测 0.10ms / 200 组（含 `file://` 解析与路径
  归一；本机口径，非 SLA），且**与每文件诊断行数无关** —— 行数那一维已被折叠 + 行 memo 挡住。
  升级触发条件：G > 1000 或实测 flush > 1ms → 再考虑 `uri→label` 缓存（随 `projectPath`
  失效）。**虚拟滚动解决的是另一维（DOM 行数），两者不可互相替代。**
- **行 key 唯一性**：`diagnosticRowKeys` = 内容指纹 + 同指纹出现序号（指纹 `M-L-C-S` 自右
  分解唯一，序号消同指纹重复）。台账落点：`problems-row-key-uniqueness`。
- **折叠阈值 20（决策，非债务）**：`COLLAPSED_GROUP_THRESHOLD` 是首屏渲染策略，不是用户语义
  上可配置的事实（项目的诊断规模是客观属性，不是偏好）。若将来确需可变：改成 **prop +
  默认值**（依赖注入），不要进全局设置 —— 那要同时动 settings 类型 / 持久化 / 面板控件三处。

## 6. 诊断行展示：code 形态无关（勿回退）

- **单一策略点**：`lsp/components/diagnosticCode.ts`（`diagnosticCodeBadge` /
  `diagnosticCodeTooltip`）。Problems 行（`DiagnosticRow`）与编辑器 hover popup
  （`lspQuickFixPopup`）都走它 —— 消费侧禁止自判 `diagnostic.code` / `codeDescription`
  （红线 12 的同源要求：同一份语义只在一处分叉）。
- **规则**：字符串 code 原样展示（有 `codeDescription.href` → 渲染成链接，打开诊断文档）；
  数字 code **不占行尾**，原值进 `title`（悬停可查）；数字 code 且服务器给了文档链接时，
  链接保留、文案取 `source`（无 source 兜底 `docs`），不把数字摆到界面上。
- **为什么形态判据而非语言判据**：jdtls 把 Eclipse `IProblem` 的内部 ID（典型
  `16777218` = `0x01000002`）当 `code` 发出 —— 对用户是纯噪音；而 TS 的 `2339` 同样是
  数字却是有用的约定编号。**两者形状完全一致**，任何"按 languageId 分别处理"的写法都
  违反红线 15。将来若要真正区分，必须由服务器在载荷里给出可分辨的数据，而不是客户端猜。
- 护栏测试：`diagnosticCode.test.ts`（12 例，含数字/字符串/带链接/兜底文案）+ 面板级
  「`16777218` 不得出现在行上」「`2339` 不在行尾但进 title」。

## 7. 常见坑

1. **Vite 预打包缓存**：改 `patches/*.patch` 后只重启 dev 不够（lockfile 哈希不变仍命中旧
   bundle），必须 `rm -rf node_modules/.vite` 或 `vite optimize --force`。
2. **`AgentConfig` 加字段必同步测试字面量**：`tests/unit/agent_test.rs` /
   `state_test.rs` 全字面量构造，缺字段即整 target 编译失败（2026-09-20 实测）。
3. **能力声明 = 行为契约**：声明 `resolveAdditionalTextEditsSupport` /
   `progressReportProvider` 而无消费实现，会让 jdtls 切私有通道致功能静默丢失；删声明
   即修进度不可见。新增声明必须同时有消费点或说明。
   **反向同罪（2026-09-22，jdtls quickfix 缺失）**：**该声明却没声明**同样静默缺失——
   `textDocument.codeAction.codeActionLiteralSupport` 未声明时，jdtls 的
   `isSupportedCodeActionKind` 对未声明 valueSet 恒 false，**丢弃全部 quickfix**
   （Java 未导入包无任何修复项，而 gopls 不检查故 Go 正常）。修复：声明
   `codeActionLiteralSupport.codeActionKind.valueSet = ["quickfix", "source"]`，且
   **不声明** `resolveSupport`（无 `codeAction/resolve` 通道，声明会让 jdtls 推迟全部
   edit）。护栏：`client_capabilities_advertise_code_action_literal_support_without_resolve`
   （valueSet 含 quickfix + resolveSupport 不得出现）。原则：改 capabilities 前先问
   「哪段代码消费它」，同一 diff 给出消费点或删掉声明——漏声明与假声明是同一契约的两面。
4. **uri 必须与 didOpen 完全一致**：编辑器 quickfix 取 `useLspClient` 算出的 `fileUri`，
   不得自己再算（`tabLspDocumentUri` 对普通文件恒 `undefined`，曾致三入口静默 return）。
5. **`didOpen` 只有一个出口**（2026-09-21 实证，事故链完整）：后端曾有三条 didOpen 发送
   路径 —— `lsp_transport` 转发分支、`lsp_request` 的内联代开、`lsp_go_to_definition`
   的内联代开；后两者各自「读盘 + 手写 `version: 1` + 裸发」，其中 `lsp_request` 那条
   还不登记。后果：同一 uri 两条 didOpen → rust-analyzer 报
   `duplicate DidOpenTextDocument`；即便不报错，服务器按 v1 推诊断而
   `@codemirror/lsp-client` 手里的文档是 v0 → 版本门
   (`params.version != file.version`) **整批丢弃** → **Problems 面板有诊断、编辑器既没
   波浪线也没 gutter 灯泡**（两个数据源分叉的典型症状，极易误判成"LSP 没起来"）。
   收敛：`document_open::ensure_document_open`（读盘代开）与
   `LspManager::send_did_open`（唯一出口：重复先补 didClose、发送、登记）——版本号一律
   由登记表推进（`next_open_version`，首开 0、之后 +1），**禁止任何地方手写 `version: 1`**。
   取证手段：`[LSP] didOpen … (previous=…)` 与版本回退告警（`non-monotonic didOpen`）；
   前端侧 `TauriLspTransport.destroy()` 之后 `send()` 变哑（否则僵尸 client 能继续用自己
   的计数器写同一会话）。
6. **uri 必须与 didOpen 完全一致**：编辑器 quickfix 取 `useLspClient` 算出的 `fileUri`，
   不得自己再算（`tabLspDocumentUri` 对普通文件恒 `undefined`，曾致三入口静默 return）。
7. **文档登记表分「重启保留」与「停止清空」两把操作**（11-12-lsp-document-identity）：
   `session_store::take_session` 只摘会话对象（`open_docs` / `editor_owned` 活着），
   `close_session` 才是「会话就此结束」（清登记、清所有权、清 restart streak）。
   `manager::take_for_close` 按 `SessionCloseNotice` 分派：`Silent`（重启/崩溃重试）→
   `take_session`，`Announce`（stop/项目停用）→ `close_session`。
   **用错的后果（2026-11-12 修复前）**：重启后 `reopen_documents` 恒重放 0 条（死代码）⇒
   服务器端文档消失（无诊断无补全直到用户编辑）；`editor_owned` 一并清 ⇒ 后端按**磁盘文本**
   代开编辑器里的未保存缓冲区 ⇒ 诊断坐标整体错位（§7.5 的事故形态）。
   回归钉：`take_session_keeps_documents_and_ownership` /
   `close_session_clears_documents_and_ownership` / `restart_keeps_open_documents`。
8. **`didChange` 必须回写登记表**（同上）：生产路径只有 `commands.rs::lsp_transport` 的通用
   转发，在那里的 `textDocument/didChange` 分支调 `record_document_change`：
   `contentChanges` 里**没有 `range`** = 全量同步 → 文本 + 版本都更新；有 `range` = 增量 →
   只推版本（文本保持，重放时 `warn` 说明可能陈旧）。未登记的 uri **不造条目**（登记表 =
   「我们 didOpen 过的文档」）。
   为什么必须：重放用的是登记表里的文本，只在 didOpen 时写一次的话，重放出去的永远是打开
   那一刻的内容（服务器按旧文本分析）。根治方向（前端在会话就绪后重发 didOpen）已记在该
   任务 PRD 的 out of scope。

## 失败诊断归属：证据锚定身份键（10-10-lsp-failure-diagnostics-ownership，勿回退）

> 事故：项目用 `rust-toolchain.toml` 钉的 toolchain 未装 rust-analyzer 组件，rustup 代理
> 在**项目根**报 `Unknown binary 'rust-analyzer'`；而 Neeko 的诊断证据挂在「成功后才有」的
> 会话对象上（失败即蒸发），版本探测又跑在**应用默认目录**（同一失败拿到绿灯），
> 失败文案只剩传输层症状「no response received」。点「View logs」得到
> `No LSP session for: <project>:<lang>`。

**原则 1（P1）：证据宿主 = 会话身份键 `(project_path, language_id)`，不是进程对象。**

- `lsp/attempt_diagnostics.rs` 的 `AttemptDiagnosticsStore`（与 `profiles` 平级）承载证据。
  **写只走句柄**（`begin` 返回 `Arc<AttemptDiagnostics>`：`push_line` / `record_failure` /
  `record_success` / `tail_inline`），**读才走 key**（`with`，键不存在返回 `None` 不报错）。
- `begin` **铸造新条目（新 `Arc`）**而不是原地清空：旧代句柄的迟到写入落进孤儿条目 ——
  不混进新一次尝试（重启竞态）、不复活被驱逐的键（AC7/AC8 的结构保障）。
  `begin` 只允许出现在 `get_or_create_session` **慢路径**（`gate.lock()` + 二次 recheck 之后、
  插件解析之前）。放 fast path 会让每条 hover / didOpen / didChange 清空活会话日志。
- **终态单写者**：装配期失败（插件/exec target/transport/build）由 manager 经本次尝试的
  句柄写；运行期崩溃由 reader 线程写。session 内部只写 log 证据，**不**写 outcome；
  失败文案随 `Err` 上抛、由 manager 一次落账（log + outcome 同源，**不得**在两处各推一遍 ——
  否则 View logs 里同一条消息出现两次）。
- **证据两侧都有界**（红线 4，两个边界两个手段）：**写入侧** `LogRingBuffer::push` 按
  `LOG_LINE_MAX_BYTES`（4KB，字符边界截头 + 截断标记）封顶单条 —— 「条目有界」是环的数据
  不变量；**读取侧** `get_server_logs` 按 `LSP_SERVER_LOGS_MAX_BYTES`（1.5MB，与
  `DIFF_PAYLOAD_MAX_BYTES` 同口径）封顶单次载荷，超预算丢更旧的条目。
- **度量只做一次，读路径纯算术**：JSON 字节数在 `push` 时算定并存进 `StoredEntry.json_bytes`
  （真实序列化长度，控制字符转义最长 6×，按内容字节近似会被击穿），`snapshot` 只做加减 ——
  序列化不再随读取次数重复发生；账目与真实序列化长度的一致性由
  `stored_byte_accounting_matches_real_serialization` 逐一比对。
- **最新一条是无条件下界**：`snapshot` 对最新一条**无条件纳入**（「至少给出一点证据」，
  与 `tail_text` 对首行同规则），故返回载荷 `≤ max(预算, LOG_ENTRY_JSON_MAX_BYTES)`
  —— 空数组与无界载荷同时不可达；`manager.rs` 用 `const _: () = assert!(…)` 在**编译期**
  钉住「IPC 预算 ≥ 单条最坏形态」。
- **失败消息必须内联证据尾部**：`tail_inline(TAIL_INLINE_MAX_BYTES)`（2KB 上限，红线 4）；
  终态文案由进入终态的**写者一次合成**并存入 `Lifecycle`（capture-at-transition）——
  `crash_message(server, tail)` 是唯一构造函数（`"{server} exited unexpectedly | stderr: …"`，
  对齐 DAP 惯例），事件与快照投影同一份字符串，读者不得各自重建。
- **确定性驱逐**：项目移除/停用（`close_sessions_for_project`，与 `profiles.remove` 同调用点）
  调 `evict_project`；按条目自持的 `project_path` **精确相等**匹配（不做键字符串前缀 ——
  路径含 `:` 也不误伤）。
- **握手等待不得挂死**：reader 线程退出时 `drain_pending` 摘除全部在途发送端，
  否则 sender 留在 map 里会让 `LspSession::new` 的 `blocking_recv` **永久阻塞**
  （mode ⑤/⑥「子进程秒退」不可解释的根因，2026-10-11 实测 oneshot 语义后补修）。

**原则 2（P2）：可用性判据与消费点同环境、同语义。**

- `lsp/spawn_spec.rs` 的 `LspExecContext { target, cwd, env }` 是探测 / 启动 / 安装
  **唯一**的「在哪执行」；`process.rs` 的 `probe_command` / `spawn_lsp_process` /
  `run_command_streaming` 只接受该上下文 —— **「不带 cwd 的探测」在类型层面不可表达**。
- 探测形态判据（方案 A「分形」，`classify_probe_run`，不按语言分支）：
  `Err`（执行不了）→ **直接失败**（真实启动必以同一错误失败，不白跑 spawn）；
  `非零 + stderr 非空`（可执行但拒绝应答）→ 记证据并**继续启动**（由 spawn + 握手兜底，
  不得因「不支持 `--version`」误杀）；超时 / 无 stderr → 仅记录，不判定。
- PATH 存在性（`check_plugin_installed`）只作为**自安装门控**；「能不能应答」由 probe +
  真实启动回答（R4：判据的失败必须能被诊断通道解释）。
- 探测 / 启动失败文案附插件 `install` 数据给出的修法提示（`installer::install_hint`，
  数据驱动，红线 15）。

**护栏**（违反即回退）：`manager.rs` 的 `failed_creation_keeps_diagnostics_readable` /
`never_attempted_key_reads_empty_not_error` / `alive_session_fast_path_does_not_reset_diagnostics` /
`server_logs_read_stays_within_ipc_budget`；
`attempt_diagnostics.rs` 的生代隔离 / 驱逐不复活 / 精确驱逐 / 环与内联上限；
`log_ring_buffer.rs` 的单条截断（字符边界 + 标记）/ 账目=真实序列化 / 读预算（条数 + 字节 + 最新一条下界）；
`process.rs` 的形态表逐行 + cwd 断言 + AC1b 组合；`lifecycle.rs` 的 capture-at-transition；
`instance.rs` 的 `await_init_response_fails_fast_when_reader_dead`。

**晋升触发条件**：出现**第二个**「失败后按身份查询长证据」的消费点时，把
`AttemptDiagnosticsStore` + `LogRingBuffer` 从 `lsp/` 提升到 `common/` —— 候选：
① DAP `stderr_buf` 的无界 `String`（`dap/transport.rs`）；② 终端任务域（任务进程失败后的
日志可达性）；③ 会话列表 / chip 需要失败尝试（把 `session_store` 与诊断合并为 per-key cell）。
未命中前不动（YAGNI）。

## 语言差异必须落在插件数据（新增 LS 零逻辑改动）

> 原 AGENTS.md 审查红线 15，2026-09-25 迁入本文件；索引保留在 `src-tauri/AGENTS.md`。

语言服务器之间的差异——会话根解析范围、检测压制、调优开关、安装方式、能力声明——一律作为
`LspPlugin`（`lsp/plugin/types.rs`）字段声明。**禁止**在通用模块里写 `language_id == "xxx"`、
语言白名单或按语言的 `if`/`match` 特例。

通用模块清单（本规则的作用域）：`lsp/session/*`、`lsp/manager.rs`、`lsp/profile.rs`、
`lsp/plugin/registry.rs`、`lsp/plugin_manager.rs`。

**Why**：R5 要求「新增 LS 零逻辑改动即获得全部能力」。代码内白名单会让新语言必须改核心模块，
且白名单与插件数据是同一知识的两种表示，必然漂移。

**How to apply**：改通用模块时若需要知道「这是哪种语言」，先问「这条知识能不能作为插件字段
携带」；能就加字段 + builder，把差异下沉到 `lsp/plugin/builtins/*`。

已数据化的字段（2026-09-18 迁移，勿回退为代码分支）：

| 字段 | 替代掉的代码特例 | 消费点 |
|------|------------------|--------|
| `root_scope: RootScope` | `is_document_root_scoped` 语言白名单 | `lsp/session/root.rs` |
| `detect_suppressed_by` | `profile.rs` 的 javascript 特例 | `plugin/registry.rs` → `suppressed_by` |
| `tuning` | 按语言的性能开关分支 | `lsp/manager.rs` |
| `extended_client_capabilities` / `client_capabilities` | 能力声明散写 | `lsp/session/instance.rs`（见下文能力声明契约） |

正例注释：`lsp/profile.rs:74` —— 「规则来自插件数据（`LspPlugin::detect_suppressed_by`），
本模块不含任何语言名」。

**护栏**：消费侧必须各有一条「自定义插件声明该数据即生效」的测试，否则数据会退化成被忽略的
装饰——没有它，字段加了没人读也测不出来：

- `document_scoped_markers_come_from_plugin_data`（`lsp/session/root.rs:464`）
- `custom_plugin_suppression_is_data_not_code`（`lsp/profile.rs:306`）
- `java_plugin_advertises_only_implemented_extended_capabilities`（`lsp/plugin/builtins/java.rs:123`）

### 能力声明必须与实现一致（原红线 14 的回归细节）

声明侧与消费侧分跨 Rust / TS 两层，规则本体留在根 `AGENTS.md`（跨域红线），此处只记实测结论：

- `resolveAdditionalTextEditsSupport: true` 令 jdtls 把 import 编辑全部推迟到
  `completionItem/resolve`，而本栈（Rust transport + `@codemirror/lsp-client`）从不发 resolve
  → Java 自动导包彻底失效。实测：声明 `true` 时 `List` 的 33 个候选 0 个带
  `additionalTextEdits`，不声明则 33/33 带。
- `progressReportProvider: true` 而全仓无 `language/progressReport` 处理 —— 同属假声明。
- **反向违约同样致命**（rust-analyzer 1.97.1）：客户端未在
  `completionItem.resolveSupport.properties` 声明 `additionalTextEdits` 时，r-a 把**所有**
  flyimport 候选整条丢弃，补全列表里永远不会出现 `HashMap`。实测：不声明 108 项无候选，
  声明后 109 项且 `HashMap` 居首。「漏声明」与「假声明」是同一条契约的两面。
- 三条实测策略（r-a 强制要声明、jdtls 声明后改走 resolve、gopls 恒内联）由**同一套通用消费者**
  `src/features/lsp/hooks/lspCompletionResolve.ts` 兜住即可。**不要因为某次事故就把能力按语言
  切成开关**——那会违反上文「语言差异落在插件数据」。声明统一写进
  `build_client_capabilities()` 全局生效。

### 冷启动就绪语义：serverStatus 与请求超时预算（勿回退）

> 事故（2026-10-11 实测，`~/.neeko/neeko.log`）：RA 起来后 chip 显示 Running，但用户
> 点击跳转「超时」，等一两分钟后正常。取证：`[perf] do_send_request textDocument/definition:
> awaited 18.815s / 18.968s / 18.482s`，hover 最高 15.2s；热身完成后 definition 0.5–8ms。

三条结论与落地：

1. **`ready`/Running 的语义 = 握手完成，不是「服务器答得快」**。RA 在 initialize 之后还有
   `Fetching → CrateGraph → Loading proc-macros → cachePriming(Indexing) → flycheck(cargo check)`
   一串 `$/progress`（这些会让 chip 显示 Indexing），但 **token 全结束后仍有「无信号尾巴」**
   （首次跳进标准库/依赖源码要现场加载）——这段里请求仍可达 18–19s。
2. **就绪必须止于服务器自述**：rust 插件声明 `experimental.serverStatusNotification: true`，
   RA 才会发 `experimental/serverStatus`（`{ health, quiescent, message }`）。消费点
   `notify::handle_server_status_notification`（reader 分发 `SERVER_STATUS_METHOD`）把
   `quiescent=false/true` 翻译成**合成进度 token**（复用前端「token 非空 ⇒ busy」投影，
   前端零改动）。实测 1.99.0：不声明 0 条；声明后 `false → true` 各一条。
   **声明与消费同 diff（红线 14）**，能力键是 `serverStatusNotification`（不是 `serverStatus`）。
3. **请求超时预算是插件数据**：通用默认 15s 覆盖不了冷启动（实测 18–19s；**同仓库存在
   第二个 rust-analyzer（VS Code）时实测首跳 89s**，且 `cargo metadata` 出现
   `Blocking waiting for file lock on package cache` —— 多实例抢 cargo 包缓存 / `target/`
   锁会成倍放大）。rust 声明 `request_timeout_ms = 120_000`（与 jdtls 同款）；同形态慢启动
   服务器（重型 JVM / 全量索引）一律在 `LspPlugin` 上声明 —— 禁止回到前端按
   `languageId` 判断（红线 15）。前端消费链：
   `registry.extension_map() → applyBackendExtensionMap → lspRequestTimeoutMs →
   new LSPClient({ timeout })`（有护栏：`plugin_request_timeout_flows_to_frontend_extension_map`、
   `languageMap.test.ts` 的 reapply 用例）。
4. **`quiescent` 不等于「答得快」**：89s 卡顿发生在 RA 自报 quiescent **之后**，期间零
   progress 事件、RA 也无 `overly long loop turn` 记录（应用侧 heartbeat 准点 → 卡的是 RA
   在等锁 / 首次按需加载，不是主循环在算）。排查「首次慢」时**先看环境里是否有第二个
   rust-analyzer 在跑**（`ps aux | grep rust-analyzer` + `lsof -p <pid> | grep cwd`）。
5. **首次语义请求慢 = RA 的 `hir_ty::infer` 单核爆炸（2026-10-11 定位，非环境问题）**：
   `app.rs::run()`（248 行，体内含 `tauri::generate_handler![308 条命令]` 展开的嵌套闭包链）
   的**一次性类型推断**实测 **95–98s、单核 100%、RSS 3.5→4.4GB**；`sample` 热栈为
   `hir_ty::infer → infer_expr_inner → infer_method_call → check_call_arguments → infer_closure`。
   独立探针（无 Neeko、无第二个 RA、无 cargo 进程）5 次全部复现（94.9/95.1/95.5/96.4/98.3s），
   之后同进程同请求 ~1ms（salsa 记忆化）。
   **廉价请求不触发它**（实测）：`documentSymbol` 0.05s、`workspace/symbol` 0.60s、
   空白处 `hover` 0.11s、全文件 `inlayHint` 0.06s —— 所以「预热」没有可靠的通用触发器；
   `quiescent` / progress 也都看不到它（RA 自报就绪早于此）。**结论：客户端无法预测或提前，
   只能给足预算 + 让等待可见**（budget 见第 3 条；可见性是待办方向）。定位命令：
   `sample <ra_pid> 8 -file /tmp/ra.txt` 抓热栈 + `ps -o %cpu=,time=,rss= -p <pid>` 看单核/内存。

排查入口：`[perf] do_send_request … awaited …`（后端真实耗时）与 `[LSP] Progress begin/end`
（服务器自述阶段）；两者对齐即可区分「服务器慢」与「客户端预算小」。


## 关闭序列：唯一实现 + 三步有界（11-12-lsp-graceful-shutdown，勿回退）

### 1. Scope / Trigger

任何「关掉一个语言服务器」的改动：`close_session` / `close_session_for_restart` /
`close_sessions_for_project`（含项目停用的 `schedule_deactivate` 定时路径）/
`close_all_sessions`（应用退出）。
新增关闭入口时**只能**调用 `manager.rs::shutdown_and_exit`（或带预算的
`shutdown_and_exit_with`），不得再拼一份序列。

### 2. Contracts

LSP 规范顺序，三步都必须**有界**：

| 步骤 | 形态 | 有界来源 |
| --- | --- | --- |
| `shutdown` | **Request**（服务器响应后才允许 `exit`） | `send_shutdown_request_bounded(grace)`：看门狗到期摘 `pending` 发送端 → `blocking_recv` 立刻以「无响应」失败 |
| `exit` | Notification | 写失败容忍（服务器可能已退），不得提前返回 |
| 等进程自行退出 | `LspProcess::wait_exit(grace)`（`Condvar` 退出门，按截止时间循环） | 超时 `false` → 才 `kill_child()` |

- **宽限期是插件数据**：`LspServerTuning::shutdown_grace_ms`（默认 `DEFAULT_SHUTDOWN_GRACE_MS = 2_000`，
  jdtls 声明 `10_000`）。会话创建时落到 `LspSession::shutdown_grace`，关闭路径**只读会话**。
  禁止 `language_id == "java"` 分支（红线 15）。
- **`kill` 必须跳过已退出的进程**（`LspProcess::kill` 先零宽限探一次退出门）：`kill_tree`
  面向 PID，PID 会被系统回收 —— 对已退出句柄发杀最多空转，对复用 PID 发杀会误杀无辜进程。
  `Drop for LspProcess` 也走这条，所以「已退出免杀」必须落在 `kill()` 内部。
- **阻塞语义**：序列最多阻塞 `响应超时 + 退出宽限`，只能在 `spawn_blocking` / 专用线程里跑（红线 3）。
  项目停用是**串行**关闭各语言会话（并发关闭会把多个 JVM 的 checkpoint 挤进同一窗口）；
  总时长是 `N × 2 × grace`（N = 该项目的语言数），不是单个 `2 × grace`。
- 任一步失败都**不得**提前返回：那会留下「终态已落、进程仍活着」的孤儿，继续持着 workspace 锁。

### 2b. 三条入口的差异化约束（同为一条序列，预算/时机不同）

| 入口 | 是否需要等序列跑完 | 预算 | 理由 |
| --- | --- | --- | --- |
| `close_session`（用户停止） | 否（fire-and-forget） | 会话宽限 | stop 是单向的，调用方不立刻重建 |
| `close_session_for_restart` | **是（`async`，必须 `await`）** | 会话宽限 | 调用方紧接着建新会话；服务器共享磁盘上的会话数据目录（jdtls `-data` 带 workspace 锁）→ 不等旧进程退出 = 两个 jdtls 抢同一把锁 |
| `close_sessions_for_project` | 否 | 会话宽限（串行） | 项目停用发生在离开 30 分钟后，无立即重建 |
| `close_all_sessions`（应用退出） | **是（同步跑完）** | `APP_QUIT_GRACE_BUDGET`（3s，各会话共享切片） | `run_cleanup_and_exit` join 完就 `process::exit(0)` —— 在这里 spawn 出去的工作**跑不到**，这正是「退出即硬杀」的成因 |

> 退出预算用尽后的兜底 `kill_child()` 是**有意的取舍**：宁可下次重建索引，也不能让用户等
> `N × 2 × grace` 才退出。

### 3. 违反现场（2026-11-12 实测，证据在 `.trellis/tasks/11-12-lsp-graceful-shutdown/research/`）

项目停用路径曾把 `shutdown` 当 **notification** 发、`sleep(10ms)` 后 `kill_child()`：

```
用户侧: jdtls exited unexpectedly | stderr: WARNING: Using incubator modules: jdk.incubator.vector
        LSP initialization: no response received | server stderr: <同一句无害警告>
真死因: <data>/.metadata/.log
        The workspace exited with unsaved changes in the previous session
        ResourcesPlugin.start() → SaveManager.restore() → ObjectNotFoundException
        → NoClassDefFoundError (jdt.core / jdt.ls.core) → "Application error" → 进程退出
```

jdtls 的致命日志**只进** `<data>/.metadata/.log`，stderr 里没有任何堆栈 —— 所以
「`exited unexpectedly` + 只有 incubator 警告」这一组合，先去看 `<data>/.metadata/.log`，
不要去猜 JDK 版本。`-data` 由启动器决定（Homebrew 的 python 启动器按 `sha1(basename(cwd))`
分目录，同名工程会撞车），手工恢复 = 删掉该目录重建（纯缓存，代价是重新 import）。

### 4. Tests Required

`manager.rs` 关闭序列测试组（缺一即回退）：

- `project_deactivate_follows_protocol_order` —— 报文逐条 `request:shutdown` → `notification:exit`
- `both_close_paths_emit_the_same_protocol_sequence` —— 单会话关闭与项目停用序列逐条相等
- `app_quit_closes_through_the_same_sequence` —— 退出路径同样走序列（不是直接硬杀）
- `restart_close_finishes_the_sequence_before_returning` —— 重启关闭在返回前已跑完序列
- `exit_is_withheld_until_shutdown_response_arrives` —— 响应未到不得发 `exit`
- `exited_server_is_not_killed` —— 宽限内自行退出后不得再 kill
- `hung_server_is_killed_after_grace` —— 卡死服务器在宽限后用尽后被收口
- `process.rs`：`wait_exit_times_out_without_signal`（有界）、`kill_is_a_no_op_after_exit`、
  `process_wait_exit_observes_exit_gate`

夹具：`session::testing::stub_session_with_writer`（暴露 writer 接收端，报文时序可断言）+
`LspProcess::test_stub(exited, killed)`（假进程，**不 spawn 真实服务器**）。夹具宽限固定 20ms，
测试里不得出现真实秒级 `sleep`。

### 5. Wrong vs Correct

```rust
// ✗ 错：notification + 固定 sleep + 硬杀（无法知道服务器是否在 checkpoint）
let _ = s.send_notification_raw("shutdown", json!({}));
thread::sleep(Duration::from_millis(10));
s.kill_child();

// ✗ 错：request 之后立刻杀（顺序对了，但 checkpoint 照样被截断）
let _ = s.send_shutdown_request();          // 甚至无界等待
let _ = s.send_notification_raw("exit", json!({}));
s.kill_child();

// ✓ 对：唯一入
spawn_blocking(move || shutdown_and_exit(session)).await;
```

### 2c. 关闭/创建互斥与握手 deadline（T0 审计整改，2026-11-12）

> 这两条是「关闭协议合规」的**闭环**：没有它们，上文的序列仍会在两条路径上被绕开。

1. **关闭与创建共用 per-key 门**：`close_session` / `close_sessions_for_project` 在**阻塞任务内**
   先取该 key 的 creation gate（与 `get_or_create_session` 慢路径同一把 `parking_lot::Mutex<()>`），
   再 `take_for_close` + 跑序列。理由：stop 是 fire-and-forget 的时代，用户 stop 后立刻敲键就
   触发新建 ⇒ 第二个 jdtls 与仍在宽限内的旧进程抢同一 `-data` 锁（与硬杀同源的故障）。
   回归钉子：`stop_holds_the_creation_gate_until_the_sequence_finishes`。
   注：`close_session_for_restart` 走 `await`（调用方紧接着重建），语义更强，不需再持门。
2. **`initialize` 握手必须有 deadline**：`await_init_response(..., timeout)` —— 看门狗到期摘
   `pending` 发送端（与 `send_shutdown_request_bounded` 同一实现，勿复制第二份）。预算 =
   `plugin.request_timeout_ms`，未声明回落 `INIT_TIMEOUT_DEFAULT`（60s）。
   为什么必须有：服务器**活而不答**（撞 `-data` 锁正是这种）时，`blocking_recv` 只由 reader 退出
   解除 ⇒ 阻塞线程 + per-key 门被永久占用 ⇒ 该 key 的每条 hover/didOpen 排队，前端每条 invoke
   永不 settle（表现为「LSP 整体没反应」，日志里只有 read 级噪音）。回归钉子：
   `await_init_response_fails_when_server_stays_silent`。
3. **退出预算是总计不是每步**：`shutdown_and_exit_with(session, budget)` 内部只算一次
   `deadline = now + budget`，`shutdown` 等待与退出宽限各取剩余额度；归零即兜底 kill。
   回归钉子：`exit_budget_is_a_total_not_per_step`（120ms 预算必须 <200ms 收口，按步实现约 240ms）。
4. **退出清理两阶段**：优雅域先跑完，`kill_all_live` 作为 finalizer 最后跑 —— 否则每次退出都
   SIGKILL 掉正在 checkpoint 的服务器（详见 `concurrency-guidelines.md`「收敛点（两阶段）」）。

## 请求级失败 vs 会话级失败（11-12-lsp-request-channel-integrity，勿回退）

### 1. 分类是**类型**，不是文案

`session/request.rs::RequestFailure` 是出站请求的唯一失败类型，`do_send_request` 返回它
（实现 `std::error::Error`，`anyhow` 调用点透明穿透）：

| 变体 | 含义 | 重启 | 消耗 streak | 用户可见 |
| --- | --- | --- | --- | --- |
| `Server { code, message }` | 服务器答了 JSON-RPC error（`-32602` 文档未打开、`ContentModified` 编辑中） | 否 | 否 | 原样上抛 |
| `Timeout { method, budget }` | 预算内没等到响应（服务器慢 ≠ 会话死） | 否 | 否 | 上抛（含方法与预算） |
| `Channel(String)` | 写失败 / 发送端丢失 / reader 已退 | **是**（唯一入口） | 是 | 上层重试一次 |
| `Cancelled` | 被更新的同类请求取消（single-flight） | 否 | 否 | `Ok(Null)` |

判据：`RequestFailure::is_session_level()` 是唯一分类函数，`manager` 的
`if !failure.is_session_level() || policy == Never => 请求级失败，直接上抛` 是唯一消费点。
`rg -n "Will restart" src-tauri/src/lsp` 只允许命中该分支的一处日志 —— 第二处 = 绕过了分类。

**Why**：曾把任何 error response 当会话故障 → 整台服务器重启（jdtls 数十秒重新导入）+
`restart_count` 只增不清零 → 5 次普通错误后该 `project:lang` **永久**
`Max restart count exceeded`，而 chip 仍显 Running、无重试入口。

### 2. 重启必须「先关后建」，streak 只在成功后清零

- **先关后建**：活会话会被 `get_or_create_session` 快路径原样复用 —— 不先
  `close_session_for_restart(...).await` 的「重启」只是计数器 +1、进程不换（旧实现的真实形态），
  且旧进程仍持 workspace 锁时新会话必然起不来。
- **streak 接账**：`close_session_for_restart` 内部 `clear_restart`（用户 stop = 从头开始），
  所以重启路径要在关闭**之前**读 `prev_count`，建好会话后 `set_restart_count(prev+1)` 接上，
  否则每次重启都从 1 开始、`MAX_RESTART_COUNT` 永不生效。
- **清零点唯一**：一次**请求成功**之后（`clear_restart`）。不得在创建成功时清零 ——
  否则崩溃循环每次都被清零，上限形同虚设。
- **预算耗尽必须可见**：经 `emit_session_error` 推 error 事件（chip 进 error + 重试入口），
  只写 `log::warn!` = 静默把该语言弄坏。

### 3. id 空间与等待边界

- **唯一 allocator**：`session::request::next_request_id()`。`initialize` / `shutdown` /
  业务请求都从它取；禁止再出现 `RequestId::from(1i32)` / `from(1000i32)`
  （曾三套 id 共用一个以 id 为键的 `pending` 表）。
- **`pending` 插入拒绝重复 id**：命中已存在即 `bail`（陈旧 sender 被 drop 会让前一个等待者
  误报「无响应」，把 id 缺陷伪装成网络问题）。
- **等待一律有界**：业务请求用 `tokio::time::timeout` 包 `rx.await`，预算取
  `LspSession::request_timeout`（插件 `request_timeout_ms`，未声明 15s）；超时与写失败走
  **同一清理**（摘 `pending` + `inflight.complete` + `$/cancelRequest`）。
  回归判据：`rg -n 'rx\.await' src-tauri/src/lsp` 不得出现裸等待。

### 4. 握手期终态单写者

`instance.rs` 的 `init_completed: Arc<AtomicBool>`：握手完成前 reader 退出**不写终态、不推
error**（`on_reader_exit` 里 `if !init_completed { return false }`），由 manager 的装配失败分支
唯一落账。否则同一故障前端收两条不同文案的 error（`exited unexpectedly` +
`no response received`），`outcome` 还依赖线程写序。

**护栏**：`request.rs` 的分类三例 + `write_failure_clears_pending_and_inflight` /
`silent_server_times_out_and_cancels` / `pending_insert_refuses_duplicate_id`；
`manager.rs` 的 `server_error_does_not_consume_restart_budget` /
`successful_request_resets_restart_streak` / `channel_failure_rebuilds_the_session` /
`handshake_failure_reports_one_error`。
