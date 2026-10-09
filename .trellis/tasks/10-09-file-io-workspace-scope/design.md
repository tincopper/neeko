# 设计：文件 IO 按 Workspace 寻址（v3：身份以值流动 + 单一编码）

> **v3 修订**：v2 只把「地址」对象化，却仍在消费侧**解析字符串还原身份**（`workspaceSessionOfKey` /
> `workspaceSessionOfTabKey`）—— 那是「假结构」。v3 的原则是：**身份在知道它的地方构造成值，之后以值
> 流动；字符串只是它在存储/传输边界的编码，由唯一 codec 产出，消费侧不再解析。**

## 1. 根因（第一性原理）

**表象**：某些调用点忘了传 `rootPath`。

**根因（逐层）**：

1. **磁盘事实**：一个 `Project` = `1 + N` 个彼此独立的工作树（主仓 + linked worktree）。
2. **动作事实**：任何「读/写文件」物理上作用于**某一个**工作树。
3. **安全模型**：后端 `read_file(FileAccessScope::InProject { root })` 要求文件在 `root` 内 ⇒
   `root` 必须是**该文件所属工作树的根**。
4. **信息位置**：「有哪些工作树、当前是哪个」的权威在**前端**；后端只有 `projectId` → 项目根。
5. **建模错误（双重）**：
   - **粒度错配**：命令按 `projectId`（容器）寻址，却作用于一个 checkout（容器内独立资源）；
   - **可选 + 错误默认**：补位的 `rootPath` 是 `Option`，默认「项目根」——对主仓恒对、对 worktree 恒错。
6. **表示错误（本版新增）**：身份被**编码成多种字符串**在各处流动（`workspace_key` 的 `\0`、`tabKey`
   的 `:wt:`），消费侧只有字符串 ⇒ 被迫加转换器把字符串**解回**对象。**只要身份以字符串流动，
   转换器就必然出现；把它们藏进 helper 不等于结构化。**
7. **收口缺失**：后端已有 git 域唯一解析器 `AppStateWrapper::resolve_workspace`，文件域却自造
   `resolve_base`，且 `read_dir_tree` 在一条命令内重复解析一次 `WorkspaceRef`。

## 2. 不变量（本任务要建立并锁死的性质）

> **① 身份是值**：`WorkspaceSession` 在知道它的地方**构造一次**，之后以**值**流动；
> **② key 是派生索引**：字符串 key 只用于 map/存储边界，由**唯一 codec**（`workspaceKeyOf` /
> `parseWorkspaceKey`）产出与消费，**消费侧不允许解析字符串来还原身份**；
> **③ 地址不可漏**：文件命令的地址参数是**必填对象**（编译期）；
> **④ 后端解析唯一**：只有 `resolve_workspace` 一条。

判据：

- 调用点还能「从字符串解出身份」吗？→ 不能（值为携带而来；`tabKey.ts` 已退役）。
- 身份有几种字符串编码？→ **一种**（`WorkspaceKey`）。
- 后端有几套 Workspace 解析？→ **一套**。

## 3. 身份：`WorkspaceSession`（自身即知 main / worktree）

```ts
// 前端 src/shared/types/workspace.ts
export interface WorkspaceSession {
  projectId: string;
  worktreePath: string | null; // null ⟺ 主 checkout（local 分支）
}
```

```rust
// 后端 common/git/workspace_ref.rs（与 WorkspaceRef 同住）
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    pub project_id: String,
    #[serde(default)]
    pub worktree_path: Option<String>,
}
```

- **`worktreePath === null` 本身即「主 checkout」**，非空即 linked worktree —— 这是**唯一**判别（不再有
  独立的 `kind` / `isWorktree` 标志：那会是同一事实的第二表示）。判别走单一谓词 `isMainCheckout(session)`。
- **只携带身份**，不带解析后的根 —— 根的权威在后端受信状态，调用方无法伪造。
- git 域同址：`worktree_path = null` 即主仓（`WorkspaceRef::resolve` 已按此收敛）。

## 4. L1：携带值（删除转换器）

| 消费点 | 现状（解字符串） | 改为（携带值） |
| --- | --- | --- |
| `useFileTabRefresh` | `parseWorkspaceKey(event.workspace_key).worktreePath` | **tab 组索引用 `event.workspace_key`（L2 后 = canonical key）；地址取 `tab.workspace`** |
| `useEditorSave`（reload） | `checkoutPathOfTabKey(tabKey)` | **`FileTab` 携带 `workspace`** → `tab.workspace` |
| `navigationHistoryStore` | 解 `loc.tabKey` | **`NavLocation` 携带 `workspace`** → `loc.workspace` |
| quick-open / links / preview / agent-chat / PR / SaveDialog / FileView | 散参 | `activeWorkspaceSession()`（读 store = 源头，非解码） |

- **删除** `workspaceSessionOfKey` / `workspaceSessionOfTabKey` —— **调用点零转换**。
- 需要 map 键时（如 status 槽 / tab 组索引），用 **`event.workspace_key` / `workspaceKeyOf(session)`** 作
  **派生索引**（唯一 codec），语义≠还原身份。

## 5. L2：单一编码（退役 `:wt:`）

- **editorStore 的 tab 组键 = canonical `WorkspaceKey`**（`workspaceKeyOf(projectId, worktreePath)`），
  不再是 `resolveTabKey`（`:wt:` 编码）。
- **退役 `src/shared/utils/tabKey.ts`**：
  - `resolveTabKey(projectId, wt)` → `workspaceKeyOf(projectId, wt)`（24 处）；
  - `parseProjectIdFromTabKey(k)` → `parseWorkspaceKey(k).projectId`（11 处；能拿到 session 的地方直接用 session）；
  - `buildWorktreeTabKey` / `WT_SEP` 删除。
- **无持久化迁移**：`SessionStore` 不含 editor tabs/layout（仅 `sidebar_width` / `worktree_state`），
  tab 组键全在内存 —— 换编码不触盘。
- `tabKey` 变量名（其值现在是 canonical key）在**改动所及**处改名为 `workspaceKey`；全仓机械改名可并入本
  Phase（83 文件多为不透明传递）。
- 护栏：禁止 `:wt:` 字面量与 `tabKey.ts` 回潮。

## 6. 后端变更（`src-tauri/src/file/commands.rs`）

8 个命令签名由 `(project_id, …, root_path: Option<String>)` 改为 **`(workspace: WorkspaceSession, …)`**：

```rust
#[tauri::command]
pub async fn read_file_content(
    workspace: WorkspaceSession,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<FileContent, AppError> {
    let (target, ws) = state.resolve_workspace_target(&workspace).await?;   // 复用既有唯一解析器
    let base = ws.root();
    // …read_file(InProject { root: base.into() }, …)
}
```

- `AppStateWrapper::resolve_workspace_target(&WorkspaceSession) -> (ExecTarget, WorkspaceRef)`
  （委托既有 `resolve_workspace`）。
- `read_dir_tree`：`ws` 既做 base 又做 `WatcherManager::gitignore_for(&ws)`（**一次解析**）。
- **删除 `resolve_base`**；不再 `resolve_project`。

## 7. 前端 api 与命令面

### 7.1 唯一文件命令面（`fileApi.ts`）——地址对象在前

```ts
readFileContent(workspace: WorkspaceSession, filePath: string): Promise<FileContent>
writeFileContent(workspace: WorkspaceSession, filePath: string, content: string): Promise<void>
readDirTree(workspace: WorkspaceSession, subPath?: string, maxDepth?: number): Promise<FileNode[]>
createNewFile / saveNewFile / createDirectory / deletePath / renamePath(workspace, …)
```

### 7.2 删除冗余的 `ProjectCommands` 文件方法

`readFileContent` / `writeFileContent` / `readDirTree` 与 module api 调用**同一后端命令**
（`read_file` 按 `ExecTarget` 路由三端）→ 移除；`createProjectCommands(workspace: WorkspaceSession)`。
`cmds ? … : …` 的文件分支退化为单一路径。

### 7.3 地址来源（每处由持有者给出，**零解析**）

见 §4 表；`runner/sourceContent.ts` / `runner/languages/io.ts` 的既有显式根源归一为 `WorkspaceSession`。

## 8. 护栏：`check_file_io_scope`（`tools/guards/checks/`）

- 口径 A：8 个文件命令的 `invoke('read_file_content'|…)` 只允许在 `fileApi.ts`。
- 口径 B：`rootPath` 散参名不得回潮。
- 口径 C（L2）：禁止**编辑 tab 键编码**回潮 —— `tabKey.ts` 模块与 `resolveTabKey` /
  `parseProjectIdFromTabKey` / `buildWorktreeTabKey` 符号。**终端会话 cache key** 的 `:wt:` 是**独立命名空间**
  （`terminalCache` / strategies，形如 `{projectId}:wt:{path}:…`，带 base64 后缀；editor 键 → 终端前缀的唯一
  换算点在 `terminalTabCleanup`），**不在本口径内** —— 把它也归一到 `WorkspaceKey` 属另案。
- 登记 `ledger/invariants.json`；按实况挂 `src/AGENTS.md` / `src-tauri/AGENTS.md` 索引。

## 9. 测试策略

- **后端**：`WorkspaceSession` 序列化/反序列化（camelCase、缺省 = 主仓）；`resolve_workspace_target`
  三态（`None` → canonical 项目根 / 合法 linked → 归一宿主根 / 穿越 → Err，`tempfile::tempdir()` 红线 13）；
  `read_dir_tree` base 与 gitignore 单元同源。
- **前端**：`isMainCheckout` / `activeWorkspaceSession`；事件携带 `workspace` 后 `useFileTabRefresh` 读到**单元**
  文件；`FileTab.workspace` + `useEditorSave` reload；`NavLocation.workspace` + 前进/后退；
  L2 后 editor tab 组键 = `workspaceKeyOf`；护栏 `test_check_file_io_scope`（含 `:wt:` 回潮）。
- **Red→Green**：先落失败测试（含 worktree 场景），再改实现。

## 10. 边界与不做

- 持久化字段名（`worktree_state`、`repo_key_prefix`）不动。
- 不改读写**行为语义**（大小上限、二进制检测、`InProject` 边界）；主仓根由「原样」归一到 canonical 属
  **表示归一**（与 watcher/gitignore 根同源），单独验证。
- **git 事件 / git 命令**的对象化 -> 另立任务 `.trellis/tasks/10-09-git-command-workspace-session`（依赖本任务）。
- LSP 会话根、并行调试、agent 会话下沉 —— 另案。
