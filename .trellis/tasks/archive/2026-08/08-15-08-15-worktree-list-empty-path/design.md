# 08-15-worktree-list-empty-path — worktree 列表空串路径显示缺失 · 技术设计

## 1. 根因分析（第一性原理，已实证）

### 1.1 数据链
```
UI WorktreeList ← project.git_info.worktrees ← get_git_branch_info 命令
  ← operations::get_git_branch_info（git2 优先，open_repo 失败则 shell 回退）
  ← 命令层 repo_path = worktree_path.as_deref().unwrap_or(&wd)
```

### 1.2 完整腐蚀链（每步实证）
1. **前端**：git-changed 事件处理器（`useSessionBootstrap.ts` L192/L226）
   `worktreePath = useWorktreeStore.getState().activeWorktreePath ?? ''` ——
   无激活 worktree 时传**空字符串** `''`。
2. **IPC 序列化**：Tauri v2 注入 JS 用 `JSON.stringify`，`undefined` 键被丢弃、`''` 保留
   → bootstrap 的 `getGitBranchInfo(p.id)`（undefined）→ Rust `None`（正常）；
   git-changed 的 `getGitBranchInfo(projectId, '')` → Rust `Some("")`（**病根**）。
3. **命令层**：`get_git_branch_info`/`get_git_info`/`get_ahead_behind` 用
   `worktree_path.as_deref().unwrap_or(&wd)` —— 只处理 `None`，**不处理 `''`** →
   `repo_path = ""`。
4. **open_repo**：`git2::Repository::open("")` 失败（`failed to resolve path ''`）→ 触发
   **shell 回退** `get_git_branch_info_shell`。
5. **shell 回退**：`run_git_opts` 构造 `cd <work_dir> && exec git ...`；`work_dir=""` 时
   **macOS `/bin/sh` 的 `cd ''` 不报错、停在当前目录**（已实证：`sh -c "cd '' && git rev-parse --show-toplevel"`
   返回 `/Users/tomgs/RustroverProjects/neeko`）。
6. **错误仓库执行**：`tauri dev` 从 neeko 仓库目录启动 → app CWD = neeko（git 仓库）→
   git 在 neeko 执行 → 返回 neeko 的 `current_branch="main"`、neeko 的分支、neeko 的
   worktrees（`git worktree list --porcelain` 仅 main → `parse_worktree_list` → `remove(0)` → `[]`）。
7. **数据污染**：前端 `.then` 把 `worktrees: []`、`current_branch: "main"` 写回 pigo 的
   `git_info` → pigo worktree 列表被清空、分支名变成 neeko 的 "main"。

### 1.3 为何「之前正常」/ 间歇
| 因素 | 正常 | 现在 |
|---|---|---|
| app 启动 CWD | 非 git 目录 → `cd '' && git` 报错 → 静默失败，worktrees 保留 | `tauri dev`（CWD=neeko 仓库）→ 返回错误数据 → 覆盖 |
| 触发时是否有激活 worktree | 有 → 传有效路径 | 无 → `''` |
| 启动竞态 | bootstrap（正确）与启动 git-changed（腐蚀）谁后到谁赢 | 间歇 |

### 1.4 独立潜在缺陷（P3）
`restoreWorktreeState` 只更新 useSessionPersistence 的 **React 本地 state**（write-only），
从未写入 zustand `worktreeStore` → session 里持久化的激活 worktree（`worktree_state`）
**跨重启不恢复**，启动时 `activeWorktreePath` 恒为 `null`，必然走 `''` 路径。

## 2. 设计决策

### 2.1 R1：共享 helper `resolve_repo_path`（空串→项目根）
- 位置：`src-tauri/src/git/commands.rs`（`pub(crate)`）。
- 语义：`None` / `''` / 纯空白 → 项目根；非空路径 → 原样。
- 一次性替换全部 24 处 `worktree_path.as_deref().unwrap_or(&wd)`（git/commands.rs 23 处 +
  agent/commands_commit.rs 1 处 `generate_commit_message`），消灭整类「空串当字面路径」问题。
- 对齐：`get_worktree_changed_files`/`get_ignored_files` 已有的 `if worktree_path.is_empty()` 处理。

### 2.2 R2：`run_git_opts` Local 分支拒绝空 `work_dir`
- 纵深防御：即使未来某调用方漏传空串，也不会 `cd ''` 在错误 CWD 跑 git，而是显式报错。
- 位置：`common/git/transport.rs` `ExecTarget::Local` 分支开头。

### 2.3 R3：前端 git-changed 传 `null`
- `getGitBranchInfo(projectId, latestWorktreePath || null)` / `getAheadBehind(...)`。
- `refreshGitFileStates` 保持 `''`（其内部 `getWorktreeChangedFiles`/`getIgnoredFiles` 已处理 `''`）。

### 2.4 R4：启动恢复激活 worktree（在 worktrees 加载**之后**）
- 位置：`useSessionBootstrap` 中 `getGitBranchInfo(activeId).then` 内 —— 此刻 worktrees 已加载，
  可校验 worktree 仍存在（`branchInfo.worktrees.find`），不存在则不恢复。
- 恢复内容：`worktreeStateMap[activeId].{activePath, activeBranch, opened}` +
  全局 `activeWorktreePath/activeWorktreeBranch/openedWorktrees`（与 `updateWtPath` 语义一致）。
- **校验 effect 硬化**（`useAppShellData` L127）：`worktrees.length > 0` 才允许清理激活态，
  避免「worktrees 尚未加载（空）→ 清掉刚恢复的激活态」竞态。

### 2.5 备选方案（未采用）
- **仅在命令层处理 `get_git_branch_info` 三个命令**：范围太窄，stage/pull/push/stash 等
  其余命令同样会因 `''` 在错误 CWD 执行 git，存在同类隐患 → 改为全量替换。
- **后端不修、只前端传 null**：依赖前端永远记得转 null，缺少纵深防御，历史已证明
  `?? ''` 模式会回归 → 前后端双修（R1+R3）都做。
- **P3 完全不动 worktree 激活态**：放弃 session 持久化的本意；用户明确要求恢复 → 保留 R4，
  但限定「worktree 仍存在才恢复」降低风险。

## 3. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 恢复 activeWorktreePath 改变启动视图（显示 worktree 引导页而非主终端） | 只恢复 store，不自动开终端；无 tabs 时显示该 worktree 的 ProjectGuidePage；session 本就持久化了激活 worktree，此为设计本意 |
| `wtState` 运行时为 null → `wtState[activeId]` 抛错 | 用 `wtState?.[activeId]` 空安全守卫 |
| 纯空白 worktree 路径 | `resolve_repo_path` 用 `trim()` 判定（比 `.is_empty()` 更稳） |
| WSL/SSH 路径为空 | `resolve_repo_path` 对任意 `''` 统一回落；WSL/SSH 由命令层传入真实 wd，不受影响 |

## 4. 涉及文件
| 文件 | 改动 |
|---|---|
| `src-tauri/src/git/commands.rs` | 新增 `resolve_repo_path` + 23 处替换 + 3 个单测 |
| `src-tauri/src/agent/commands_commit.rs` | `generate_commit_message` 用 helper |
| `src-tauri/src/common/git/transport.rs` | Local 分支拒绝空 `work_dir` |
| `src/features/session/hooks/useSessionBootstrap.ts` | git-changed 传 null（P2）+ 启动恢复（P3） |
| `src/app/hooks/useAppShellData.ts` | 校验 effect 硬化（空列表不清理） |
| `src/features/session/hooks/__tests__/useSessionBootstrap.test.ts` | 新增 git-changed 传参回归测试 |
