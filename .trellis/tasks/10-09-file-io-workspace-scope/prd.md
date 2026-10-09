# 文件 IO 按 Workspace 寻址（scope 根因修复）

## Goal

文件读写的地址统一为一个 **Workspace 值对象 `WorkspaceSession`**；身份在知道它的地方**构造一次**并**以值流动**，
字符串只是存储/传输边界的**编码**（唯一 codec），消费侧**不再解析还原身份**；地址在类型上不可漏传。

> 一句话：把「`scope` 是散参/字符串、靠调用点记忆」还原为
> 「**一个身份值 + 一套解析 + 单点构造 + 零转换**」。

## Background（症状）

Local + worktree 下，一批文件通道静默失效（被 catch 吞掉，无报错）：自动刷新 `useFileTabRefresh`、
外部改动 reload `useEditorSave`、前进/后退 `navigationHistoryStore`、quick-open / 终端与任务链接 /
定义跳转 / HTML 预览 / agent-chat 读文件 / PR 文件面板。

根因（三层）见 `design.md §1`：**粒度错配**（按 projectId 寻址、按 checkout 作用）+ **可选且默认错误的
`rootPath`** + **身份以多种字符串编码流动，迫使消费侧加转换器**。**不采用**逐点补 `rootPath`，也**不采用**
把解析藏进 helper。

## Requirements

- **R1 地址对象化**：8 个文件命令（`read_dir_tree` / `read_file_content` / `write_file_content` /
  `create_new_file` / `save_new_file` / `create_directory` / `delete_path` / `rename_path`）统一接收
  `workspace: WorkspaceSession`（`{ projectId, worktreePath }`，`worktreePath = null` = 主 checkout）。
- **R2 解析唯一**：后端复用 `AppStateWrapper::resolve_workspace`（经 `resolve_workspace_target`），
  **删除 `resolve_base`**；`read_dir_tree` 的 base 与 gitignore 过滤器复用**同一个** `WorkspaceRef`。
- **R3 类型不可漏**：前端 `fileApi` 的地址参数**必填对象**；省略 = 编译失败。
- **R4 身份以值流动（L1）**：**删除** `workspaceSessionOfKey` / `workspaceSessionOfTabKey` 等转换器；
  身份由持有者携带 —— `FileTab` 携带 `workspace`、`NavLocation` 携带 `workspace`、当前视图用
  `activeWorkspaceSession()`；事件的 `workspace_key` 仅作 tab 组**索引**（不解析还原身份）。**调用点零解析**。
- **R5 单一编码（L2）**：退役**编辑 tab** 的 `:wt:` 编码 —— editorStore 的 tab 组键 = canonical `WorkspaceKey`；
  删除 `src/shared/utils/tabKey.ts`（`resolveTabKey` / `parseProjectIdFromTabKey` / `buildWorktreeTabKey` / `WT_SEP`）。
  无持久化迁移（editor tabs 仅内存）。
- **R6 自述 main/worktree**：`WorkspaceSession.worktreePath === null` ⟺ 主 checkout，**唯一**判别（不设独立
  `kind`/`isWorktree` 字段 —— 那是第二表示）；判别走单一谓词 `isMainCheckout(session)`。
- **R7 删除冗余命令面**：`ProjectCommands` 的 `readFileContent` / `writeFileContent` / `readDirTree`
  与 module api 调用同一后端命令，属重复包装 → 移除；`createProjectCommands(workspace: WorkspaceSession)`。
- **R8 防回归**：护栏 `check_file_io_scope` —— 裸 `invoke('read_file_content'|…)` 仅允许在 `fileApi.ts`；
  `rootPath` 散参名不得回潮；`:wt:` 与 `tabKey.ts` 不得回潮。
- **R9 测试**：后端地址解析与序列化；`isMainCheckout` / 各通道「读对单元」；L2 后 tab 组键 = `WorkspaceKey`；
  护栏测试。
- **R10 不改行为**：只改「寻址与身份的表示」，不改读写语义（大小上限、二进制检测、gitignore 语义）；
  主仓根由「原样」归一到 canonical 属表示归一，单独验证。

## Acceptance Criteria

- [ ] 文件命令地址参数 = `workspace: WorkspaceSession`；不存在 `root_path` 参数。
- [ ] 后端文件解析只有 `resolve_workspace` 一条；`resolve_base` 已删除；`read_dir_tree` 不再重复解析。
- [ ] 前端 `readFileContent` / `writeFileContent` / `readDirTree` / `saveNewFile` … 的地址参数**必填对象**。
- [ ] **无** `workspaceSessionOf*` 转换器；所有调用点的地址由持有者携带（tab/history/store），零解析。
- [ ] 编辑 tab 的 `:wt:` 编码已退役，`tabKey.ts` 已删除；editorStore 的 tab 组键 = `WorkspaceKey`。
- [ ] `ProjectCommands` 不再有文件方法；WSL/Remote 文件读写走同一 `fileApi`。
- [ ] main 只以 `worktreePath = null` 表示；无「用项目根当 scope」的调用点。
- [ ] 护栏 `check_file_io_scope` 生效（含测试），`pnpm guards list` 可见。
- [ ] worktree 下：自动刷新 / reload / 前进后退 / quick-open / 链接跳转 / HTML 预览 / agent-chat 均读对单元。
- [ ] `pnpm check` 全绿。

## Out of Scope

- git 事件与 git 命令的对象化 —— **已另立后续任务**
  `.trellis/tasks/10-09-git-command-workspace-session`（其 `prd.md` 写明依赖本任务）。
- LSP 会话跟随 worktree 根（另案）。
- 并行调试、agent 会话下沉到 Workspace（另案）。
- WSL/Remote 的 `file-changed` 事件单元（当前仅 Local 发；地址携带已就绪，登记为遗留）。
- **终端会话 cache key 的 `:wt:` 命名空间**归一（`terminalCache` / strategies / `parseProjectIdFromWslKey`）——
  与编辑 tab 键不是同一契约（带 base64 后缀、按 pane 定址），另案处理。

## Notes

- 权威术语定义：`docs/domain-model.md`（`Workspace`=容器 / `checkout`=git 属性 / `worktree`=git 原生）。
- 相关红线：前端红线 12（路径身份唯一化）、后端命令层极薄、红线 3（阻塞隔离）、红线 15（语言差异落插件）。
