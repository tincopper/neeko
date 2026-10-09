# 执行计划：文件 IO 按 Workspace 寻址（v3）

> 依赖：无前置任务。**TDD**：每步先落失败测试 → 实现 → 确认通过。
> 结构：**前半 L1（身份以值流动，删转换器）** + **后半 L2（单一编码，退役 `:wt:`）**，两半各自可独立验证；
> 二者**均在本任务内**（L2 = Phase 4），不另立任务。

## Phase 0 — 基线与判据

1. 读既有：`guards/checks/check_path_identity_scope.py`、`guards/core/*`、`ledger/invariants.json`、
   `guards/tests/`；`app_state.rs::resolve_workspace`、`common/git/workspace_ref.rs`。
2. 基线：`pnpm check` 全绿；记录 `fileApi` / `ProjectCommands` / `commandFactory` 既有签名。
3. 落「红」测试（此时必失败）：
   - `workspaceRef.test.ts`：`activeWorkspaceSession()` / `isMainCheckout(session)`（尚不存在）。
   - `useFileTabRefresh.test.ts`：断言读取地址 = `tab.workspace`（携带值，非解析）。
   - `useEditorSave*.test.ts`：reload 首参 = `tab.workspace`。
   - `navigationHistoryStore.test.ts`：前进/后退首参 = `loc.workspace`。
   - `editorStore`（L2）：tab 组键 = `workspaceKeyOf(...)`（`:wt:` 形态不再出现）。
   - `tools/guards/tests/test_check_file_io_scope.py`：裸 invoke / `rootPath` / `:wt:` 回潮违规。

## Phase 1 — 后端：`WorkspaceSession` + 唯一解析

1. `src-tauri/src/common/git/workspace_ref.rs`：新增
   ```rust
   #[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
   #[serde(rename_all = "camelCase")]
   pub struct WorkspaceSession { pub project_id: String, #[serde(default)] pub worktree_path: Option<String> }
   ```
2. `src-tauri/src/app_state.rs`：
   `pub async fn resolve_workspace_target(&self, s: &WorkspaceSession) -> Result<(ExecTarget, WorkspaceRef), AppError>`
   （委托 `resolve_workspace`）。
3. `src-tauri/src/file/commands.rs`：8 命令签名 → `(workspace: WorkspaceSession, …)`；
   `let (target, ws) = state.resolve_workspace_target(&workspace).await?; let base = ws.root();`
   （`read_dir_tree` 的 gitignore 用同一 `ws`）；**删除 `resolve_base`**。
5. 测试：序列化/反序列化；`resolve_workspace_target` 三态（红线 13 `tempfile::tempdir()`）。`cargo test`。

> 事件载荷**不改**：`FileChangedEvent` / `FileTreeChangedEvent` 保留 `workspace_key`（作为 tab 组**索引**，L2 后 = canonical key）；身份由 `FileTab.workspace` 携带。

## Phase 2 — 前端：身份类型 + 携带值（L1）

1. `src/shared/types/workspace.ts`（新）：`WorkspaceSession` 接口并从 types barrel 导出。
2. `src/shared/utils/workspaceRef.ts`：`isMainCheckout(session)`；`src/shared/store/workspaceStore.ts`：
   `activeWorkspaceSession()`（复用 `activeWorkspaceKeyOf`）。**不加** `workspaceSessionOf*` 转换器。
3. `src/shared/types/file.ts`：`FileTabData` 增 `workspace: WorkspaceSession`（**同步 `mergeTabData`**，见 state-management 常见错误 7）。
4. `src/shared/store/navigationHistory.ts`：`NavLocation` 增 `workspace`；`navigationHistoryStore` 记录/使用它。
5. `src/features/editor/hooks/useEditorSave.ts`：reload 用 `tab.workspace`；
   `src/features/editor/hooks/useFileTabRefresh.ts`：tab 组索引用 `event.workspace_key`、读取地址用 `tab.workspace`
   （去掉 `commands` 分支与 `parseWorkspaceKey` 解析）。

## Phase 3 — 收敛命令面 + 迁移调用点

1. `fileApi.ts`：8 包装器地址参数 = `workspace: WorkspaceSession`（必填、首位），`invoke(…, { workspace, … })`。
2. `ProjectCommands`（`shared/types/activeProject.ts`）与 `commandFactory.ts`：移除 3 个文件方法；
   `createProjectCommands(workspace: WorkspaceSession)`；更新 `use-active-project/index.ts`。
3. 迁迁移点（地址由持有者给出，**零解析**）：
   - `useFileViewTabOps.ts` / `useFileView.ts` / `useFileTreeSync.ts` → `activeWorkspaceSession()`；
     展示根继续 `workspaceRootOf(workspaceKeyOf(session), projectRoot)`（去「项目根当 scope」）。
   - `useFileTabRefresh.ts` → `event.workspace`；`useEditorSave.ts` → `tab.workspace`；
     `navigationHistoryStore.ts` → `loc.workspace`。
   - `quick-open/openFile.ts`、`quick-open/store/quickOpenStore.ts`、`terminalLinks.ts`、`consoleLinks.ts`、
     `definitionTarget.ts`、`HtmlPreview.tsx`、`AgentChatTabView.tsx`、`PRFilesChangedPanel.tsx`、
     `SaveFileDialog.tsx` → `activeWorkspaceSession()`。
   - `runner/sourceContent.ts`、`runner/languages/io.ts`：既有显式根源 → `WorkspaceSession`。
4. `tsc`：编译期列出所有缺地址的调用点（强制生效的证明）。

## Phase 4 — L2：单一编码（退役 `:wt:`）

1. `editorStore`：tab 组键 = `workspaceKeyOf(projectId, worktreePath)`；`activeTabId`/`editorLayout` 同步。
2. 全仓替换 `resolveTabKey(pid, wt)`（24 处）→ `workspaceKeyOf(pid, wt)`；
   `parseProjectIdFromTabKey(k)`（11 处）→ `parseWorkspaceKey(k).projectId`（能拿 session 处直接用 session）。
3. **删除 `src/shared/utils/tabKey.ts`**（`resolveTabKey` / `parseProjectIdFromTabKey` /
   `buildWorktreeTabKey` / `WT_SEP`）及其测试。
4. `tabKey` 变量名在改动所及处改为 `workspaceKey`（值 = canonical key）。
5. 回归：`rg ":wt:"`、`rg "resolveTabKey|parseProjectIdFromTabKey"` 均为空。

## Phase 5 — 护栏

1. `tools/guards/checks/check_file_io_scope.py` + `tools/guards/tests/test_check_file_io_scope.py`：
   - A：8 文件命令的 `invoke('…')` 只允许在 `fileApi.ts`。
   - B：`rootPath` 散参名不得出现。
   - C：`:wt:` 字面量与 `tabKey.ts` / `resolveTabKey` / `parseProjectIdFromTabKey` 不得回潮。
2. 登记 `ledger/invariants.json`；按实况挂 `src/AGENTS.md` / `src-tauri/AGENTS.md` 索引。
3. `pnpm guards list` 可见；`python3 tools/guards/run.py run --stage local` 全绿。

## Phase 6 — 收口验证

1. 补/绿 Phase 0 测试；全量 `pnpm check`。
2. 人工核对 AC（地址对象必填 / 无转换器 / 单一编码 / main 只 `null` / 无裸 invoke / 无文件方法）。
3. **主仓根 canonical 归一的单独验证**：Local 主仓下 `read_dir_tree`/`read_file_content` 行为一致
   （gitignore `same_root`、`InProject` 边界不回归）。
4. 同步 spec：`docs/domain-model.md`（「寻址根 vs 展示根」）、`.trellis/spec/frontend/api-layer.md` /
   `state-management.md`、`.trellis/spec/backend/git-domain.md`（§12 指针）。

## 提交拆分（Conventional Commits，英文）

1. `refactor(file): address file IO by a WorkspaceSession value object`（Phase 1–3，L1）。
2. `refactor(editor): key editor tabs by the canonical workspace key`（Phase 4，L2）。
3. `test(guards): enforce file IO workspace addressing`（Phase 5）——或并入。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 主仓根 canonical 归一改变 base 形态 | Phase 6 专项验证；与 watcher/gitignore 根本就同源 |
| `FileTab` 新字段被 `mergeTabData` 剥离 | 同步 `mergeTabData`（state-management 常见错误 7）+ 测试钉住 |
| 事件载荷改动波及多个消费点 | 一次性列出全部消费点并测试；git 事件不在本任务（另立） |
| 删除 `ProjectCommands` 文件方法影响 WSL/Remote | `read_file` 已按 `ExecTarget` 路由三端、同一命令；用现有 WSL/Remote 用例回归 |
| `:wt:` 退役引发遗漏解析点 | `rg ":wt:"` / 函数名 全仓归零 + 护栏口径 C |
| `WorkspaceSession` 序列化大小写不符 | `#[serde(rename_all = "camelCase")]` + 往返测试 |
