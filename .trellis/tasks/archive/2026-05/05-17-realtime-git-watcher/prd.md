# PRD: 实时 Git Watcher

## 问题

当前 Git Commit Panel 存在 5 个性能瓶颈，导致点击面板后加载缓慢，与 VS Code 的实时 Git 体验差距明显：

1. **Watcher 路径走全量刷新** -- `git-changed` 事件触发 `refresh_git_info`（全量），再 `get_project`（再锁一次 Mutex），再触发 `get_changed_files_diff_stats_command`（第三次打开仓库）。一次文件保存 = 3 次 `Repository::open` + 2 次全量 status 扫描。
2. **轮询无差异检测** -- 仓库脏状态下，每 3 秒触发完整刷新链，即使文件列表没有变化。
3. **`get_git_info` 内部重复打开仓库** -- `get_git_branch_info(repo_path)` 内部再次 `Repository::open`，不接受已打开的 `&Repository`。
4. **NonRecursive 监听 + 轮询补偿** -- 只监听项目根目录直接子条目变化，深层文件变化依赖 3s 轮询子进程，延迟高。
5. **两条刷新路径不统一** -- watcher 用旧的全量 `refresh_git_info`，手动操作用分离的 `get_worktree_changed_files` + `get_git_branch_info_command`。

## 目标

对标 VS Code Git 扩展的实时感知能力：
- 文件变化后 < 1s 反映到 Changed Files 列表
- 无变化时零开销
- Diff stats 仅在 panel 可见时计算

## 决策汇总

| # | 决策 | 改动范围 |
|---|------|---------|
| 1 | Watcher 改为 Recursive + ignore 过滤（.git/node_modules/target 等） | `watcher.rs` |
| 2 | 去掉 3s 轮询线程 | `watcher.rs` |
| 3 | 后端新增 diff-aware 脏检测：对比上次 status 结果，无变化不发事件 | `watcher.rs` |
| 4 | `git-changed` 事件统一走 split 轻量路径（与手动刷新一致） | `useSessionBootstrap.ts` |
| 5 | `get_git_branch_info` 内部改为接受 `&Repository`，消除重复 open | `git/local.rs` |
| 6 | Diff stats 仅在 GitCommitPanel 可见时加载 | `GitCommitPanel.tsx` |

## 不做的事（留给 v2）

- 不改 `handleRefreshGit` 手动路径（已经是分离调用）
- 不改 WSL/Remote 的 git 刷新路径
- 不引入前端 debounce（后端已做 800ms debounce + diff-aware）
- 不做增量 diff 命令（复杂度高，收益与 split 路径差距不大）
- 不做 throttle 调度器替换 debounce（v2: `05-17-realtime-git-watcher-v2`）
- 不做常驻 git 进程池（v2）
- 不做前端增量 diff 更新（v2）
- 不加 `--no-optional-locks`（v2）

---

## TDD 开发计划

按 vertical slice 组织，每个 slice 一个 RED→GREEN 循环。

### Slice 1: `get_git_branch_info` 接受 `&Repository` 参数

消除 `get_git_info` 内部的重复 `Repository::open`。

**行为测试（Rust，真实临时仓库）**：
- `get_git_info_reuses_repository` -- `get_git_info` 返回的 branch info 和 changed files 一致（验证内部不因复用而出错）
- `get_git_branch_info_with_repo_returns_same_as_path_version` -- 新旧签名返回相同结果

**改动文件**：
- `src-tauri/src/git/local.rs`: `get_git_branch_info` 新增接受 `&Repository` 的内部版本，`get_git_info` 调用新版本
- 保留 `pub fn get_git_branch_info(repo_path: &Path)` 公共签名不变（命令层仍用它）

### Slice 2: Watcher 改为 Recursive + ignore 过滤

**行为测试（Rust，集成测试）**：
- `watcher_emits_on_deep_file_change` -- 在 `src/deep/file.txt` 写入后，watcher 发出事件
- `watcher_ignores_git_dir_changes` -- 在 `.git/` 内写入，watcher 不发事件
- `watcher_ignores_node_modules` -- 在 `node_modules/` 内写入，watcher 不发事件

**改动文件**：
- `src-tauri/src/watcher.rs`: `RecursiveMode::NonRecursive` → `RecursiveMode::Recursive`，添加路径过滤逻辑

### Slice 3: 去掉轮询线程，新增 diff-aware 脏检测

**行为测试（Rust）**：
- `watcher_no_event_when_status_unchanged` -- 文件保存但 git status 结果与上次相同时，不发 `git-changed` 事件
- `watcher_emits_when_status_changes` -- 新增文件后 status 变化，发事件
- `watcher_emits_when_file_deleted` -- 删除已跟踪文件，发事件

**改动文件**：
- `src-tauri/src/watcher.rs`: 去掉 `thread::spawn` 轮询线程；debounce 回调内做 `git status --porcelain` 快速检测 + 与上次结果对比

### Slice 4: 前端 `git-changed` 统一走 split 轻量路径

**行为测试（Vitest，mock invoke）**：
- `git_changed_event_calls_split_commands` -- 收到 `git-changed` 事件后，调用 `get_worktree_changed_files` 和 `get_git_branch_info_command`，不调用 `refresh_git_info`
- `git_changed_event_updates_store_incrementally` -- store 中 `changed_files` 和 `current_branch` 分别更新

**改动文件**：
- `src/hooks/useSessionBootstrap.ts`: `listen("git-changed")` 回调改为调用 split 命令

### Slice 5: Diff stats 仅在 panel 可见时加载

**行为测试（Vitest）**：
- `diff_stats_not_loaded_when_panel_hidden` -- `GitCommitPanel` 未挂载时，`get_changed_files_diff_stats_command` 不被调用
- `diff_stats_loaded_when_panel_visible` -- `GitCommitPanel` 挂载后，正确请求并显示 diff stats

**改动文件**：
- `src/components/project/GitCommitPanel.tsx`: `useEffect` 增加 panel 可见性判断条件

---

## 验收标准

1. `cargo test` 全部通过，含新增的 watcher / git info 测试
2. `pnpm test:run` 全部通过，含新增的 session bootstrap / commit panel 测试
3. `pnpm lint && pnpm type-check` 通过
4. 文件变化后 Commit Panel 刷新延迟 < 1s（手动验证）
5. 无文件变化时，watcher 不触发刷新（通过 diff-aware 测试验证）
6. 深层目录文件变化（如 `src/nested/file.rs`）可被实时捕获
