# Git 历史展示域重构（LogScope + refs 分类）与剪贴板权限修复

## Goal

当前 `get_commit_log` 硬编码 `git log --all`，把第三方工具（如 Synara）的私有 checkpoint refs（`refs/synara/checkpoints`）当作历史展示，污染用户视图。从第一性原理重构：历史展示范围 = **当前选择的分支**（`git log HEAD`），分支在 Changes 面板切换，历史自动跟随；不再用 `--all` 把所有 refs 混排。按 `refs/` 命名空间建立 refs 分类原则——branch/remote/tag/stash 正常渲染，工具私有 refs（`refs/synara/*` 等）一律不渲染。Git Control 面板新增 **Stash 独立 tab**（位于 History 右侧，展示：列表 + 点击展开文件变更 + 单文件 diff 内容查看 + Apply/Pop 操作）。顺带修复复制 hash 失败（`navigator.clipboard.writeText` 无兜底 + capabilities 缺 write-text 权限）。交互式原型 HTML 与 Trellis 任务同目录管理。

## Background / 根因

- `src-tauri/src/common/git/operations.rs:500` 与 `local.rs:1047` 均使用 `git log --all --decorate=full`。
- `git log --all` 遍历所有 refs 命名空间（含 `refs/stash`、`refs/synara/*`、`refs/aider/*` 等），工具 checkpoint refs 因此进入历史列表。
- `parse_commit_log_output`（`parsers.rs:289`）原样透传 `%D` decorate 字符串，前端 `formatRefs`（`commitListUtils.ts:66`）不做来源分类。
- 复制：`CommitListItem.tsx:128` 用 `void navigator.clipboard.writeText(commit.hash)`，无 `.catch()`；capabilities 只授权 `clipboard-manager:allow-read-text`。

## Requirements

1. **展示范围 = 当前分支**：`get_commit_log`（命令 + operations 两处）移除 `--all`，改为 `git log HEAD`（显式 `HEAD` rev 参数，语义明确防回归）；切换 checkout 分支后历史自动跟随（现有 `onRefreshGit → refresh` 链路）。
2. **refs 分类纯函数**：解析 `%D` decorate，按前缀归类 `branch / remote / tag / stash / tool`；`tool`（`refs/stash` 之外的任何非 heads/remotes/tags 前缀，如 `refs/synara/*`、`refs/aider/*`）一律不渲染。规则通用，不硬编码具体工具名。`HEAD -> branch` / `HEAD`（detached）归入 branch 语义。
3. **refs 标签分类渲染**：branch / remote / tag / stash 使用可区分的样式；tool refs 永不渲染（即使该提交作为分支祖先出现）。
4. **不做「所有分支混排」视图**：历史面板只有当前选择分支的提交；分支切换发生在 Changes 面板（现有 BranchSwitcherPanel），历史跟随，不新增范围切换 UI。
5. **Stash 独立 tab（含内容查看 + Apply/Pop）**：Git Control 面板新增第三个 tab「Stash」（位于 History 右侧，tab 栏顺序 Changes / History / Stash），选中后主体展示 `git stash list` 内容（`stash@{N}` 选择器、摘要、来源分支、时间）；点击某条展开其文件变更列表；**点击文件按需加载单文件 diff（内容查看）**；行 hover 提供 **Apply**（`git stash apply`，应用后保留该条）与 **Pop**（`git stash pop`，应用后移除该条并刷新列表与徽章计数）操作。后端新增 `get_stash_list` / `get_stash_files` / `get_stash_file_diff` / `stash_apply` / `stash_pop` 命令。
6. **复制修复**：复制 full hash 改用 `@tauri-apps/plugin-clipboard-manager` 的 `writeText`，capabilities 补 `clipboard-manager:allow-write-text`；所有 `navigator.clipboard.writeText` 调用点统一错误兜底（失败 toast 反馈，对齐 NotificationDetail 既有模式）。
7. **原型 HTML**：交互式 UI 设计原型放 `.trellis/tasks/08-14-git-history-log-scope/prototypes/`，随 Trellis 任务一起版本管理；展示分支切换后历史跟随、refs 分类染色、synara refs 被排除、Stash 独立 tab、复制反馈。

## Acceptance Criteria

- [ ] 在含 `refs/synara/checkpoints` 的仓库中，历史面板只展示当前 checkout 分支的提交；`--all` 才会出现的孤立 synara checkpoint 提交不再出现；stash 分类保留（若作为分支装饰出现则渲染为 stash 标签）。
- [ ] 切换 checkout 分支后（Changes 面板），历史列表跟随新分支（现有 `onRefreshGit → refresh` 链路），无需手动切换。
- [ ] Git Control 面板 tab 栏为 Changes / History / Stash（Stash 在 History 右侧）；选中 Stash 展示 stash 列表（选择器/摘要/分支/时间），点击某条展开文件变更；点击文件查看单文件 diff；无 stash 时显示空态。
- [ ] 行 hover 提供 Apply / Pop：Apply 应用后保留该条；Pop 应用后移除该条并刷新列表与徽章计数；操作中按钮 loading 禁用防重复；冲突时错误 toast 展示冲突信息且列表不刷新。
- [ ] `get_stash_list` / `get_stash_files` / `get_stash_file_diff` / `stash_apply` / `stash_pop` 命令注册于 `neeko_invoke_handler!`，WSL/SSH/本地三态走统一 transport。
- [ ] refs 标签按 branch / remote / tag / stash 分类渲染，样式可区分；`refs/synara/*` 等 tool refs 标签不出现。
- [ ] 复制 full hash 不抛 `NotAllowedError`；失败时有 toast 反馈；`capabilities/default.json` 含 `clipboard-manager:allow-write-text`。
- [ ] Rust 单测覆盖：refs 分类函数（含 synara/stash/HEAD 用例）、`get_commit_log` 不再包含工具私有 refs、stash list 解析。
- [ ] 前端单测覆盖：refs 分类渲染 tool refs 不出现、Stash tab 展开交互、复制 hook 回退路径。
- [ ] 交互式原型 HTML 位于任务 `prototypes/` 目录，可在浏览器中直接打开并操作（分支切换 + 分类染色 + Stash tab + 复制反馈）。

## Notes

- 不硬编码 `synara`：分类规则基于 refs 命名空间前缀，未来任何新工具自动归类为 tool。
- `local.rs` 的同步版 `get_commit_log` 与 `operations.rs` 的 transport 版保持同一「HEAD + refs 过滤」语义。
- 复制修复的「统一错误兜底」优先收敛为共享 hook，避免散落各处的裸 `navigator.clipboard.writeText`。
- stash 分类保留：`refs/stash` 属于用户自有状态，若作为提交装饰出现则渲染 stash 标签，与其他工具私有 refs 不同对待。
- Stash 内容查看采用「按文件按需加载单文件 diff」（`git stash show -p <selector> -- <path>`），复用 commit diff 解析与 DiffView，规避 IPC 2MB 大文本红线；apply/pop 冲突时 `git stash pop` 保留 stash 条目，错误 toast 展示冲突文件，列表不刷新。
