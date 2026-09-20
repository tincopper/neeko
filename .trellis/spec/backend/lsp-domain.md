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

## 3. 重构台账（F1-F7，后来者勿回退）

| 项 | 约定 |
|---|---|
| F1 | `applyCodeAction` 只认注入的 `EditorViewResolver`；`runAiQuickFixAction` 走 `aiActionRegistry` 端口 |
| F2 | 终端创建（配额 `MAX_TERMINAL_TABS`/ID/排序）只住 `terminal/api/taskTerminal.ts`，editor 只调端口 |
| F3 | `aiActionRegistry` 与 `editorViews` 同构引用计数（`{handler/view, count}`），注销归零才删 |
| F5/F7 | `lspQuickFix.ts` 只装配；渲染（`quickFixMenuRender`）vs 派发（`quickFixMenuActions`）vs popup vs gutter 单向依赖；探针纯函数住 `lspCompletionProbe.ts` |
| 行数 | 非测试源码 <300 行；`lsp/types.rs:383` 含约 117 行内联测试（净源码约 266 行），属已知豁免；`instance.rs` 存量胖（本次 +8 行），不扩范围 |
| F4 | shell 选择在执行层（`platform/shell_launch` 的 `cmd /c` vs `sh -c`），拼装层只做 sh 转义并显式委托注释 |

## 4. 常见坑

1. **Vite 预打包缓存**：改 `patches/*.patch` 后只重启 dev 不够（lockfile 哈希不变仍命中旧
   bundle），必须 `rm -rf node_modules/.vite` 或 `vite optimize --force`。
2. **`AgentConfig` 加字段必同步测试字面量**：`tests/unit/agent_test.rs` /
   `state_test.rs` 全字面量构造，缺字段即整 target 编译失败（2026-09-20 实测）。
3. **能力声明 = 行为契约**：声明 `resolveAdditionalTextEditsSupport` /
   `progressReportProvider` 而无消费实现，会让 jdtls 切私有通道致功能静默丢失；删声明
   即修进度不可见。新增声明必须同时有消费点或说明。
4. **uri 必须与 didOpen 完全一致**：编辑器 quickfix 取 `useLspClient` 算出的 `fileUri`，
   不得自己再算（`tabLspDocumentUri` 对普通文件恒 `undefined`，曾致三入口静默 return）。
