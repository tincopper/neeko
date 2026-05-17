# PRD: 优化 Commit 变更加载速度

## 问题

Commit 面板（`GitCommitPanel`）显示文件变更列表时响应偏慢，尤其在大项目或文件变更多时。
根因分析见 grill-me 会话（5 项瓶颈已识别）。

## 决策汇总

| # | 决策 | 改动范围 |
|---|------|---------|
| 1 | `handleRefreshGit` 用 `get_project` 替代 `loadProjects`（单项目更新） | `useLocalProjects.ts` |
| 2 | `get_changed_files` 拆出 diff 统计，前端异步懒加载（B1+S2） | `local.rs` + 新命令 + `GitCommitPanel.tsx` |
| 3 | R5 智能 polling：`git status --porcelain` 脏检测，间隔 10s→3s | `watcher.rs` |
| 4 | 不加前端 debounce | — |

## 改动清单

### Backend
- [ ] `local.rs`: `get_changed_files` 去掉 diff 计算（保留 statuses）
- [ ] `local.rs`: 新增 `pub fn get_changed_files_diff_stats(repo_path)`
- [ ] `models/project.rs`: 新增 `FileDiffStats` struct
- [ ] `commands/git.rs`: 新增 `get_changed_files_diff_stats_command`
- [ ] `commands/mod.rs`: 注册新命令到 `neeko_invoke_handler!`
- [ ] `watcher.rs`: polling 改为 3s + `git status --porcelain` 脏检测 + 排除 `.git` 路径事件

### Frontend
- [ ] `useLocalProjects.ts`: `handleRefreshGit` → `get_project` 替代 `loadProjects`
- [ ] `GitCommitPanel.tsx`: `useEffect` 异步调用 `get_changed_files_diff_stats`，合并 stat 到文件列表渲染
