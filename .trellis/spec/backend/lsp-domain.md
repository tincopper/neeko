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
| 行数 | 非测试源码 <300 行；`lsp/types.rs:383` 含约 117 行内联测试（净源码约 266 行），属已知豁免；`instance.rs` 存量胖（本次 +8 行），不扩范围 |
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

## 5. Problems 大项目性能（09-20-problems-perf：P1-P3）

> 触发：jdtls 初次构建短时对数百文件逐个 `publishDiagnostics`，N 次直写 → N 次订阅通知
> → 面板 N 次全量 buildGroups + 全行挂载，千行级卡顿。

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
- 已知边界（不扩）：`buildGroups` 每次 store 变化全量重排（虚拟滚动/增量分组范畴）；
  行 key `${message}-${line}-${char}-${severity}` 重复诊断碰撞（既存）。

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

## 4. 常见坑

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
