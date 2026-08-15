# 08-15-worktree-list-empty-path — 实施记录

## 1. 实施顺序（P1→P2→P3，TDD）

### 1.1 P1 后端根治
1. `src-tauri/src/common/git/operations.rs`：
   - 新增 `pub fn resolve_worktree_path(worktree_path, wd) -> &str`（`#[must_use]`）：
     `None` / `''` / 纯空白 → `wd`；非空 → 原样。
   - 测试随函数同置：`None`→wd、`''`→wd、纯空白→wd、有效路径→原样（3 个用例）。
2. `src-tauri/src/git/commands.rs`：`use crate::common::git::operations::resolve_worktree_path;`
   替换全部 `worktree_path.as_deref().unwrap_or(&wd)`（23 处）。
3. `src-tauri/src/agent/commands_commit.rs`：`generate_commit_message` 同样替换
   （`crate::common::git::operations::resolve_worktree_path`）——helper 归位共享 git 域层，
   消除 agent→git::commands 跨域命令模块依赖。
4. `src-tauri/src/common/git/transport.rs`：`run_git_opts` `ExecTarget::Local` 分支开头
   对空 `work_dir` 返回 `Err`（纵深防御）+ `#[tokio::test]` 守卫测试。

### 1.2 P2 前端兜底
- `useSessionBootstrap.ts` git-changed 处理器：新增 `const repoPathArg = latestWorktreePath || null;`，
  `getGitBranchInfo(projectId, repoPathArg)` / `getAheadBehind(projectId, repoPathArg)`；
  `refreshGitFileStates(projectId, latestWorktreePath)` 保持 `''`。
- **测试**：`src/features/session/hooks/__tests__/useSessionBootstrap.test.ts`（新文件）——
  mock `listen` 捕获 `GIT_CHANGED_EVENT` handler + fake timers 推进去抖：
  - 无激活 worktree → `getGitBranchInfo('p1', null)` / `getAheadBehind('p1', null)`（回归断言）
  - 激活 worktree → 传 worktree 路径

### 1.3 P3 启动恢复
- `useAppShellData.ts` 校验 effect：`worktrees.length > 0` 才清理激活态（防「先清后加载」竞态）。
- `useSessionBootstrap.ts`：`getGitBranchInfo(activeId).then` 内，worktrees 加载后，
  若 `wtState?.[activeId]` 命中 `branchInfo.worktrees`，把 `activePath/activeBranch/opened` +
  全局镜像写入 zustand `worktreeStore`（与 `updateWtPath` 语义一致）；`wtState?.[...]` 空安全守卫。

## 2. 改动文件清单
```
M src-tauri/src/git/commands.rs                  # resolve_repo_path + 23 替换 + 3 单测
M src-tauri/src/agent/commands_commit.rs          # 1 替换
M src-tauri/src/common/git/transport.rs           # 空 work_dir 拒绝
M src/features/session/hooks/useSessionBootstrap.ts  # P2 传 null + P3 恢复
M src/app/hooks/useAppShellData.ts                # 校验 effect 硬化
A src/features/session/hooks/__tests__/useSessionBootstrap.test.ts  # 4 个回归测试（P2×2 + P3×2）
```

## 3. 门禁结果（已跑，全绿）
| 门禁 | 结果 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml` | 728 unit（含 4 新）+ 91 integration，0 失败 |
| `cargo fmt --check` | OK |
| `cargo clippy`（标准，`pnpm lint` 同款） | 0 warning / 0 error |
| `npx tsc --noEmit` | 0 error |
| `pnpm lint:fe` | 1733 测试通过 / 0 type error / eslint 干净 |

> 注：`cargo clippy --all-targets` 会在 `tests/unit/{agent,git}_test.rs` 报既有 unwrap 告警，
> 属**仓库既有**问题，不在本任务改动范围，标准门禁（`cargo clippy` 不带 `--all-targets`）不涉及。

## 4. 真机复测清单（`pnpm tauri dev` 重启后）
- [ ] **AC1** 无激活 worktree 时 pigo worktree 列表显示 `Test` + `test1`。
- [ ] **AC2** pigo 分支名显示 `master`（非 neeko 的 `main`）。
- [ ] **AC3** 在 worktree 内切分支 / 新建 worktree，列表不再被清空或污染。
- [ ] **AC4** 激活 Test worktree 后重启，Test 仍为激活态。

## 5. 已知边界
- session 不持久化 tabs：恢复激活 worktree 后该 worktree 的 tab 空间为空 → 显示其
  ProjectGuidePage（引导页），需用户点「打开终端」才建立 PTY —— 符合当前 session 设计。
- `resolve_repo_path` 对任意命令统一生效；WSL/SSH 由命令层传真实 wd，不受影响。

## 6. neeko-check 合规修复（增量审核后）
- **Nit（已修复）**：helper 初版置于 `git/commands.rs`，`agent/commands_commit.rs` 跨域引用命令模块
  → 迁移到 `common/git/operations.rs`（共享 git 域层），消除跨域命令模块耦合。
- **Warning（已修复）**：P3 恢复逻辑缺直接测试 → 新增 2 个（存在恢复 / 不存在不恢复）。
- **Nit（已修复）**：`run_git_opts` 空 work_dir 守卫分支未测 → 新增 `#[tokio::test]`。
- **Nit（已修复）**：clippy `#[must_use]` 缺失 → 已加；前端 prettier 格式 → `eslint --fix`。
