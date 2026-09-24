# 调研纪要：编辑器行级 git 变更高亮（2026-09-24）

只读探索结论，供 design/implement/check 子代理上下文注入。

## 1. 后端 diff 能力

- `get_file_diff(project_id, file_path, worktree_path?, collapse?, …) -> DiffResult`
  （`src-tauri/src/git/commands/query.rs:129-147`，注册于 `lib.rs` `neeko_invoke_handler!`）。
- 口径：**HEAD vs 工作区+暂存合并**（git2 `diff_tree_to_workdir_with_index`；shell 路径 `git diff` 同语义）。
- `DiffHunk { old_start, old_lines, new_start, new_lines, lines: Vec<DiffLine> }`；
  `DiffLine = Context | Added | Removed | Collapsed` —— **行本身不带行号**，new 侧行号从 `new_start` 递增推导。
- 纯 untracked 新文件：空 hunks 时后端 fallback 构造单个全 `Added` hunk（`old_start:0, new_start:1`）。
- `collapse=true` 只折叠长段 Context → `Collapsed`，**不删 Added/Removed**；行映射与词级配对不受影响。
- **不存在**行级 `Vec<(line, status)>` 命令；`get_changed_files_diff_stats` 仅文件级。
- 禁令：`git-domain.md` —— 不得持有跨挂载的模块级 diff 缓存；每次展示直接拉取。
- IPC 红线：单次 JSON ≤ 2MB；DiffResult 已有 `truncated` 与体积护栏。

## 2. 前端 git 状态管道（文件级，已有）

- 权威快照事件：`GIT_STATUS_SNAPSHOT_EVENT` = `"git-status-snapshot"`（`watcher/types.rs:10` ↔ `src/shared/events.ts:18`）；兜底 `GIT_CHANGED_EVENT` = `"git-changed"`。
- 监听：`src/features/git/hooks/useGitStatusEventsSync.ts` → `projectStore.applyGitStatus`。
- 文件状态存放：`projectStore.projects[].git_info.changed_files: FileChange[]`（**不是** `gitStore`）。
- 内容变更：`FILE_CHANGED_EVENT` = `"file-changed"`，`useFileChangedEvent` 共享单例。
- **编辑器（FileEditor/View）当前完全不读 `changed_files`**。
- `get_file_diff` 的前端 invoke 封装：`src/features/git/api/gitApi.ts:257`。

## 3. 编辑器扩展装配

- 装配链：`FileEditor.tsx:170` `useUnifiedGutterExtension` → `:181` `useEditorExtensions` → `FileEditorView` `<CodeMirror extensions={…}>`。
- **reconfigure 纪律**（`useEditorExtensions.ts:47-53`）：`extensions` 引用一变即全量 `StateEffect.reconfigure`。高频数据（行状态）**禁止**进 extensions memo，必须 **StateField + StateEffect**（范例 `useBreakpointGutter.ts` 的 `setBreakpointsEffect` / `breakpointField`；decoration 范例 `currentLineDecoField`）。
- Gutter 注册表：`gutter/contribution.ts` `GutterContribution { id, priority, when, linesOf, markersOf, render, onClick? }`；合并器 `gutter/registry.ts` 单列 `cm-breakpoint-gutter`，同行按 priority，冲突表 `CONFLICT_WINNER='run'`。
- 现有贡献：breakpoint(10) / run(20) / testStatus(30)；装配点 `useUnifiedGutter.ts:74-76`。
- 单元测试 harness：`gutter/__tests__/registry.test.ts`（真 EditorView）；`useUnifiedGutter.test.ts`（renderHook 长度契约）。

## 4. 设置链路（成熟，后端零改动）

- `AppConfig`（`src/shared/types/settings.ts`）→ `DEFAULT_CONFIG` + load 归一（`useAppConfig.ts`）→ `EditorPanel.tsx` Switch → `AppContext` → `FileViewer.tsx:40` `config` → FileEditor。
- `save_config`/`load_config` 对 `config.json` 自由 JSON 透传，**加 TS 字段即可持久化，Rust 不改**。

## 5. 防火墙与约束

- 跨 feature 只准直导 `store/`、`types/`、`api/`；editor **不得** import `git/components/diff/diffViewUtils`（feature 内部）。
- `invoke` 只在各 feature `api/`（`gitApi.ts` 已有 `get_file_diff`）。
- 事件名双端常量，禁硬编码（红线 5）。
- 路径匹配注意红线 12 FileRef：`changed_files` 相对仓库根 vs tab 路径口径。
- 行级数据若做派生纯函数，放 **git feature 公开门面**（facade re-export hook/纯函数）或 `shared/utils`，editor 只消费类型化结果。

## 6. 缺口 → 设计映射

| 缺口 | 设计决策 |
|---|---|
| 无行级命令 | 方案 A：前端从 `get_file_diff` hunk 推导（零后端）；derive 纯函数隔离，日后可换 unified=0 命令（OCP） |
| 编辑器不读 git 状态 | git feature 出 `useFileLineChanges` hook，经 facade 导出 |
| 无变更条/行背景 | 独立 `cm-change-gutter` 薄列（被动状态，不进交互 registry）+ Decoration StateField |
| 高频数据通道 | 单 StateField + StateEffect，extensions 引用稳定 |
| 刷新时机 | 打开/切文件拉取；`git-status-snapshot` / `git-changed` / `file-changed` 去抖重拉；不新增事件 |
| 设置开关 | `editorGitChangeHighlight?: boolean` 默认 true，全链路成熟模式 |
| 冲突策略 | 变更条独立列，不参与 `CONFLICT_WINNER` 表，与断点/run 共存 |
| 删除行 | 编辑器不渲染（IDEA 一致），仅 DiffView |
