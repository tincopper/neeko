# PRD: Commit Panel 即时加载

## 问题

点击 Commit Panel 后需要 1-3s 才能看到数据。两种场景都慢：
1. 切换 dock tab 到 Commit（项目已选中）
2. 选择项目后查看 Commit Panel

根因分析发现 3 个瓶颈，全部位于**面板打开路径**，与 watcher 刷新路径无关：

### 瓶颈 1: `get_changed_files_diff_stats_command` 极重（两个场景共有，主瓶颈）

`GitCommitPanel.tsx:52-72` 的 `useEffect` 在面板挂载时触发，调用 `get_changed_files_diff_stats_command`。
Rust 端（`git/local.rs:81-185`）做了 4 件事：
1. `Repository::open` -- 打开仓库
2. `repo.statuses()` -- 全量 status 扫描（**冗余**，前端已有 changed_files）
3. `diff.foreach()` -- 遍历每个变更文件的**每一行**计算 +/- 行数
4. 对 untracked 文件 `std::fs::read_to_string` 读**整个文件**数行数

大型 untracked 文件（Cargo.lock、生成代码等）会直接卡住。这个命令**无缓存**，每次面板挂载都重新计算。

### 瓶颈 2: `handleSelectProject` 串行阻塞（场景 B 独有）

`useAppContainer.ts` 的 `handleSelectProjectWithClear` 串行执行 3 个 IPC 调用：
```
await invoke("set_active_project")                    ← IPC #1
await loadProjects() → invoke("list_projects")        ← IPC #2，序列化所有项目（含 git_info）
await fileView.loadFileTree(projectId, project.path)  ← IPC #3，读文件树
```
全部完成后 Commit Panel 才开始渲染。

### 瓶颈 3: `list_projects` 传输所有项目的完整 git_info（场景 B 独有）

`list_projects` 返回 `pm.list_projects()` 即所有项目的 clone，每个项目包含完整的 `changed_files` 数组。5 个项目 × 50 个变更文件 = 序列化大量冗余数据。

## 目标

- Commit Panel 打开后**文件列表 < 100ms 可见**（数据已在 store 时）
- Diff stats（+/- 行数）允许异步加载，但首次应 < 500ms
- 选择项目后到 Commit Panel 可见 < 300ms

## 决策汇总

| # | 决策 | 解决瓶颈 | 改动范围 |
|---|------|---------|---------|
| 1 | `diff stats` 改用 `git diff --stat` 子进程替代 git2 逐行遍历 | 瓶颈 1 | `git/local.rs` |
| 2 | diff stats 结果后端缓存，watcher 变更时失效 | 瓶颈 1 | `git/local.rs` + `watcher.rs` |
| 3 | `handleSelectProject` 不再 await `loadFileTree` | 瓶颈 2 | `useAppContainer.ts` |
| 4 | `list_projects` 改为不返回 `changed_files`，git_info 已在 store 中维护 | 瓶颈 3 | `commands/project.rs` + `project.rs` |

### 瓶颈 4: `handleSelectProject` 调 `loadProjects` 覆盖 store 中已有的 `changed_files`（数据流 bug）

Slice 1-4 落地后仍然慢。根因追踪发现是 Slice 4（`list_projects` 不返回 `changed_files`）与 `handleSelectProject` 的执行顺序产生数据竞争：

1. 用户点击项目 → `setActiveProjectId(id)` → store 中 `activeProject` 指向已有 `changed_files` 的项目
2. `await loadProjects()` → `list_projects` 返回 `changed_files: []` → `setProjects` 触发 store 更新
3. `setProjects` 内部 `activeProject = nextProjects.find(id)` → `activeProject` 被替换为 `changed_files: []` 的版本
4. Commit Panel 渲染 → `project.gitInfo?.changed_files` = 空 → 空面板
5. 等待 watcher `git-changed` 事件重新填充 → 1-3s 后面板才有数据

同时，bootstrap 阶段也有问题：`useSessionBootstrap` 第二次 `list_projects` 返回的项目 `git_info` 存在但 `changed_files` 为空，`if (!p.git_info)` 判断跳过了这些项目，不触发 `refresh_git_info`，只能等 watcher 慢慢填充。

## 不做的事

- 不改 `GitCommitPanel` 组件结构（已经是 split 渲染：文件列表 + 异步 diff stats）
- 不改 watcher 触发链路（v1/v2 已优化）
- 不改 WSL/Remote 路径

## 决策汇总（更新）

| # | 决策 | 解决瓶颈 | 改动范围 | 状态 |
|---|------|---------|---------|------|
| 1 | `diff stats` 改用 `git diff --numstat` 子进程 | 瓶颈 1 | `git/local.rs` | 已完成 |
| 2 | diff stats 后端缓存 + watcher 失效 | 瓶颈 1 | `git/local.rs` + `cache.rs` | 已完成 |
| 3 | `handleSelectProject` 不再 await `loadFileTree` | 瓶颈 2 | `useAppContainer.ts` | 已完成 |
| 4 | `list_projects` 不返回 `changed_files` | 瓶颈 3 | `commands/project.rs` | 已完成 |
| 5 | `handleSelectProject` 不再调 `loadProjects`，直接从 store 切换 | 瓶颈 4 | `useLocalProjects.ts` | 已完成 |
| 6 | bootstrap 判断改为 `!p.git_info?.changed_files?.length` | 瓶颈 4 | `useSessionBootstrap.ts` | 已完成 |
| 7 | `get_ahead_behind` 结果后端缓存 + watcher 失效 | 瓶颈 5 | `git/local.rs` + `cache.rs` | 已完成 |
| 8 | `PullRequestsPanel` 默认折叠时不加载 PR 列表 | 瓶颈 6 | `PullRequestsPanel.tsx` | 已完成 |
| 9 | bootstrap 改用 split 轻量路径替代全量 `refresh_git_info` | 瓶颈 7 | `useSessionBootstrap.ts` | 已完成 |
| 10 | `DockZone` 保持所有 panel 挂载，切换用 CSS 隐藏 | 瓶颈 8 | `DockZone.tsx` | **新增** |

---

## TDD 开发计划

### Slice 1: `git diff --stat` 替代 git2 逐行遍历

**问题**：`get_changed_files_diff_stats` 用 `diff.foreach` 遍历每个文件每一行，对 untracked 文件读整个文件内容。这是最大的耗时来源。

**目标行为**：改用 `git diff --stat` + `git diff --cached --stat` 子进程，一次获取所有文件的 +/- 统计。对 untracked 文件用 `wc -l` 而非 `read_to_string`。

**行为测试（Rust，真实临时仓库）**：
- `diff_stats_detects_modified_file` -- 修改已跟踪文件后，返回正确的 additions/deletions
- `diff_stats_detects_untracked_file` -- 新建 untracked 文件后，additions = 文件行数，deletions = 0
- `diff_stats_empty_on_clean_repo` -- 干净仓库返回空列表
- `diff_stats_handles_binary_file` -- 二进制文件返回 0/0，不崩溃

**改动文件**：
- `src-tauri/src/git/local.rs`: `get_changed_files_diff_stats` 改用 `git diff --numstat` 子进程

**关键实现**：
```rust
// 替代 diff.foreach 逐行遍历
// git diff --numstat 一次输出所有文件的 additions/deletions
// 格式: "10\t5\tpath/to/file"
let output = Command::new("git")
    .args(["diff", "--numstat", "--no-optional-locks"])
    .current_dir(repo_path)
    .output()?;
```

### Slice 2: diff stats 后端缓存 + watcher 失效

**问题**：每次面板挂载都重新计算 diff stats，即使文件没有变化。

**目标行为**：后端缓存 diff stats 结果，只在 watcher 检测到文件变化时失效。面板重新打开时命中缓存直接返回。

**行为测试（Rust）**：
- `diff_stats_cache_returns_same_result` -- 连续两次调用，文件未变，结果相同且第二次更快
- `diff_stats_cache_invalidated_on_change` -- 修改文件后缓存失效，返回新结果

**改动文件**：
- `src-tauri/src/git/local.rs`: 用 `git/cache.rs` 现有缓存框架包装 diff stats
- `src-tauri/src/watcher.rs`: 文件变化时调用 `invalidate_repo_caches`（已有机制）

### Slice 3: `handleSelectProject` 不串行等待 `loadFileTree`

**问题**：`handleSelectProjectWithClear` 中 `await fileView.loadFileTree()` 阻塞了后续渲染，但文件树和 Commit Panel 是独立的 dock panel，没有数据依赖。

**目标行为**：`loadFileTree` 改为 fire-and-forget，不阻塞项目切换流程。Commit Panel 可以在文件树加载完成前渲染。

**行为测试（Vitest，mock invoke）**：
- `select_project_does_not_await_file_tree` -- `handleSelectProjectWithClear` 返回后，store 已更新 activeProject，不等 loadFileTree
- `file_tree_loads_independently` -- loadFileTree 失败不影响 activeProject 设置

**改动文件**：
- `src/hooks/useAppContainer.ts`: `await fileView.loadFileTree(...)` → `fileView.loadFileTree(...).catch(console.error)`

### Slice 4: `list_projects` 不返回 `changed_files`

**问题**：`list_projects` 返回所有项目的完整 `git_info`（含 `changed_files` 数组），但前端 store 已通过 watcher 事件维护了 `changed_files`。项目列表调用不需要这些数据。

**目标行为**：`list_projects` 返回轻量版项目数据，`changed_files` 置空。前端 store 中的 `changed_files` 由 watcher/handleRefreshGit 维护，不被 `list_projects` 覆盖。

**行为测试（Rust）**：
- `list_projects_returns_empty_changed_files` -- 即使 ProjectManager 内部有 changed_files，list_projects 返回的项目 changed_files 为空

**行为测试（Vitest）**：
- `load_projects_preserves_existing_git_info` -- `loadProjects` 调用后，store 中已有的 `changed_files` 不被清空

**改动文件**：
- `src-tauri/src/commands/project.rs`: `list_projects` 返回前清空 `changed_files`
- `src/hooks/useLocalProjects.ts`: `loadProjects` 合并逻辑，保留 store 中已有的 `git_info.changed_files`

### Slice 5: `handleSelectProject` 不再调 `loadProjects`

**问题**：`handleSelectProject` 调 `await loadProjects()` 会触发 `list_projects` IPC，返回的轻量版项目（`changed_files: []`）覆盖 store 中 watcher/handleRefreshGit 已填充的数据。而且项目列表本身在 store 中已经是完整的，切换项目不需要重新拉取。

**目标行为**：`handleSelectProject` 只做两件事：1) 更新 store 中的 `activeProjectId`/`activeProject`；2) 通知后端 `set_active_project`。不再调 `loadProjects`。

**行为测试（Vitest）**：
- `select_project_preserves_changed_files` -- store 中已有 changed_files，切换项目后 changed_files 不被清空
- `select_project_updates_active_project` -- 切换后 activeProject 指向正确的项目

**改动文件**：
- `src/hooks/useLocalProjects.ts`: `handleSelectProject` 去掉 `await loadProjects()`

### Slice 6: bootstrap 判断补充 `changed_files` 空检测

**问题**：`useSessionBootstrap` 用 `if (!p.git_info)` 判断是否需要刷新。但 `list_projects` 现在返回 `git_info` 存在但 `changed_files` 为空的项目，导致跳过刷新。

**目标行为**：判断条件改为“`git_info` 不存在或 `changed_files` 为空”时触发刷新。

**行为测试（Vitest）**：
- `bootstrap_refreshes_project_with_empty_changed_files` -- `git_info` 存在但 `changed_files` 为空时，触发 `refresh_git_info`

**改动文件**：
- `src/hooks/useSessionBootstrap.ts`: `if (!p.git_info)` → `if (!p.git_info?.changed_files?.length)`

### Slice 7: `get_ahead_behind` 后端缓存

**问题**：Commit Panel 挂载时 `useEffect[project.id]` 触发 `refreshAheadBehind()`，内部调 `get_ahead_behind_command`。Rust 端串行执行 3 个 git 子进程（`git rev-parse` ×2 + `git rev-list --left-right --count`），大仓库上耗时 500ms-1s。该数据只用于 BranchInfo 组件显示 `↑2 ↓3`，与文件列表无关。

**目标行为**：后端缓存 `get_ahead_behind` 结果，通过 `invalidate_repo_caches` 在 watcher/git 操作后失效。缓存命中时直接返回，无子进程开销。

**改动文件**：
- `src-tauri/src/git/cache.rs`: 新增 ahead_behind 缓存，纳入 `invalidate_repo_caches`
- `src-tauri/src/git/local.rs`: `get_ahead_behind` 调用缓存层

### Slice 8: `PullRequestsPanel` 折叠时不加载 PR 列表

**问题**：`PullRequestsPanel` 挂载时无条件触发 3 个 IPC：`is_gh_installed_command` + `load_vcs_settings_command` + `list_prs_command`。其中 `list_prs_command` 调用 `gh pr list`，是网络请求，可达 1-3s。即使用户不关心 PR，每次打开 Commit Panel 都会触发。

**目标行为**：`loadPRs` 仅在 `expanded === true` 时执行。折叠状态下不发起网络请求。

**改动文件**：
- `src/components/project/PullRequestsPanel.tsx`: `loadPRs` 添加 `expanded` 前置检查

### Slice 9: bootstrap 改用 split 轻量路径

**问题**：`useSessionBootstrap` 检测到 `changed_files` 为空时，调用重量级的 `refresh_git_info`（全量 `get_git_info`：branch 扫描 + status 扫描 + worktree 扫描），然后再调 `get_project` 取完整对象。这是两次串行 IPC + 一次重量级后端操作。

**目标行为**：改用与 watcher `git-changed` 相同的 split 路径（`get_worktree_changed_files` + `get_git_branch_info_command`），直接 patch store，不再调 `refresh_git_info` 和 `get_project`。

**改动文件**：
- `src/hooks/useSessionBootstrap.ts`: bootstrap 刷新逻辑改为 split 路径

### Slice 10: `DockZone` 保持所有 panel 挂载

**问题**：`DockZone.tsx` 只渲染当前 `activePanelId` 对应的组件。切换时 React 卸载旧组件 + 挂载新组件：`React.lazy` chunk 加载 + 所有 `useState` 重置 + 所有 `useEffect` 重新触发。这是用户可感知的卡顿根源，与数据加载无关。

`DockZoneTabs` 已用 `data-[state=inactive]:hidden` 解决了同样问题，但 `DockZone`（单 panel 模式）没有这个机制。

**目标行为**：`DockZone` 同时渲染所有已注册的 panel 组件，非活跃的用 CSS `hidden` 隐藏。切换时只切 CSS 类，不卸载/挂载组件。

**改动文件**：
- `src/components/dock/DockZone.tsx`: 遍历 `zone.panels` 渲染所有组件，非活跃的加 `hidden`

---

## 验收标准

1. `cargo test` 全部通过，含 diff stats 缓存 / numstat 解析测试
2. `pnpm test:run` 全部通过，含 store 合并 / 项目选择测试
3. `pnpm lint && pnpm type-check` 通过
4. 切换 dock tab 到 Commit：文件列表 < 100ms 可见（手动验证）
5. 选择项目后 Commit Panel 数据 < 300ms 可见（手动验证）
6. diff stats 缓存命中时 < 50ms 返回（日志验证）
