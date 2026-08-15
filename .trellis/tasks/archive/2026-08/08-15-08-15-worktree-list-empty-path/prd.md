# 修复 worktree 列表在无激活 worktree 时显示缺失

## Background（背景）

本地项目的 worktree 列表（`ProjectGitSection → WorktreeList`）在部分场景下只显示
「local」一行，linked worktrees 不显示。此前正常，worktrees 是**当天创建**（`~/.neeko/worktrees/Test`、
`~/.neeko/worktrees/test1`）后出现的问题，且与「用 `pnpm tauri dev` 从 neeko 仓库目录启动」同时存在。

## Problem Statement（问题陈述）

1. **直接现象**：projects 面板中 pigo 项目的 worktree 列表为空（只显示 local），
   但 `git worktree list` 确认磁盘上存在 `Test`、`test1` 两个 linked worktrees。
2. **数据链**：列表渲染 `project.git_info.worktrees`；该字段由 `get_git_branch_info` 填充。
3. **数据源**：Rust `get_worktrees`（git2）对 pigo 主仓库/任意 worktree 打开均正确返回
   `[Test, test1]`（已实证）。问题不在 git2 读取，而在**调用方传入的 repo 路径**。

## Requirements（需求）

1. **R1（后端统一空串语义）**：所有接收 `worktree_path: Option<String>` 的 git 命令，
   把空字符串/纯空白视为「未指定 worktree」并回落项目根目录 —— 与
   `get_worktree_changed_files` / `get_ignored_files` 既有处理一致。
2. **R2（纵深防御）**：本地 git 执行路径拒绝空 `work_dir`，杜绝 `cd ''` 在 app 启动 CWD
   执行 git（macOS `/bin/sh` 的 `cd ''` 不报错、停在当前目录）。
3. **R3（前端兜底）**：git-changed 全量刷新在无激活 worktree 时向 `get_git_branch_info` /
   `get_ahead_behind` 传 `null`（→ Rust `None`）而非 `''`。
4. **R4（启动恢复激活 worktree）**：session 持久化的激活 worktree（`worktree_state`）在启动
   时恢复到 zustand store（此前只存不读）；worktree 列表未加载完成时不得清理激活态。
5. **R5（回归测试）**：后端 `resolve_repo_path` 纯函数单测 + 前端 git-changed 处理器
   worktree 路径传参测试。

## Acceptance Criteria（验收标准）

- [ ] **AC1**：无激活 worktree 时，pigo 项目 worktree 列表显示 `Test` + `test1` 两行（不只 local）。
- [ ] **AC2**：pigo 分支名恢复为 `master`（修复前可能被污染成 neeko 仓库的 `main`）。
- [ ] **AC3**：会话中新建/删除 worktree、worktree 内切分支触发的 git-changed 刷新不再清空/污染
      worktree 列表与分支名。
- [ ] **AC4**：重启 app 后，若 session 记录了激活 worktree 且该 worktree 仍存在，
      应用恢复其为激活态（worktree 列表高亮、视图指向 worktree）。
- [ ] **AC5**：新增回归测试通过：Rust `resolve_repo_path`（None/`''`/纯空白/有效路径）×3；
      前端 git-changed 处理器（无激活→null、有激活→路径）×2。
- [ ] **AC6**：全量门禁通过：`cargo test`、`cargo fmt --check`、`cargo clippy`、`pnpm lint:fe`、`tsc --noEmit`。

## Out of Scope（非目标）

- WSL/SSH 远程项目的 worktree 恢复（`useProjectActions` 走独立路径，不受本修复影响）。
- worktree 终端/PTY 的跨重启重连（session 不持久化 tabs，恢复激活态后显示该 worktree 的引导页）。
- 重构 `worktreeStateMap`/`updateWtPath` 为 store action（保持最小改动）。
