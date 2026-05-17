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

## 不做的事

- 不改 `GitCommitPanel` 组件结构（已经是 split 渲染：文件列表 + 异步 diff stats）
- 不改 watcher 触发链路（v1/v2 已优化）
- 不改 WSL/Remote 路径

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

---

## 验收标准

1. `cargo test` 全部通过，含 diff stats 缓存 / numstat 解析测试
2. `pnpm test:run` 全部通过，含 store 合并 / 项目选择测试
3. `pnpm lint && pnpm type-check` 通过
4. 切换 dock tab 到 Commit：文件列表 < 100ms 可见（手动验证）
5. 选择项目后 Commit Panel 数据 < 300ms 可见（手动验证）
6. diff stats 缓存命中时 < 50ms 返回（日志验证）
