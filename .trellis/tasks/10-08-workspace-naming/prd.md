# 领域命名收敛：App → Project → Workspace（能力容器）

> 状态：**规划中（未动代码）**。术语决策见 `design.md`，执行批次见 `implement.md`。

## Goal

把「一个 Project 下、承载 IDE/Agent/editor/debug/LSP/terminal 的独立工作上下文」这一节点统一命名为 **`Workspace`**，并确立分层术语：

```
App → Project → Workspace（能力容器）→ ide / agent / editor / debug / lsp / terminal
                     └ checkout（属性：path / kind(Main|Worktree) / branch / HEAD）
                     └ root（属性：scope 基准 = ${workspaceFolder}）
```

让「谁拥有这些功能状态」「scope 由谁派生」在命名上**唯一且无歧义**。

## Problem Statement（命名现状的可观察问题）

| 症状 | 现状 |
| --- | --- |
| 同一概念多个名字 | 「单元根」有 `unitRoot` / `unitWorkDir` / `work_dir()` / `resolveRunCwd` / `resolveUnitRoot` / `projectRootOf` / `unitRootForProject` 等 6+ 拼法 |
| 节点概念无名字 | 「承载 IDE/Agent/editor/debug/LSP/terminal 的容器」在代码里没有统一名；`Repo`/`worktree` 都只描述它的**属性** |
| 顶层与中间层重名风险 | `workspace` 已被 LSP 协议（`WorkspaceEdit`/`workspaceFolders`）与 `${workspaceFolder}` 使用，需明确归属 |
| 组件名与领域名混淆 | `ProjectWorkspace.tsx` 组件与将要确立的领域对象 `Workspace` 同名 |

## 问题本质（第一性原理）

一次「工作」的真值依赖是 `(Workspace, 功能)`，其中 `Workspace` = `Project` 的一个工作上下文，`checkout`/`root` 是它的**属性**。现有代码把「属性」（仓库/worktree）当成了「容器」的名字，于是同一容器被按不同属性命名（repo/worktree/unit），产生同义碎片。

**术语不变量**：一个概念一个名字；属性不进容器名。

## Scope

### In

- **Tier 0**：术语表 + 分层图写入 spec/docs（唯一正文，不在多处复述）。
- **Tier 1**：UI 组件 `ProjectWorkspace.tsx` → `ProjectView.tsx`（释出 `Workspace` 给领域对象）。
- **Tier 2（本批次）**：收敛 runner 侧「单元根」同义命名族（`unitRootForProject` 等）→ `Workspace*` 命名，单点派生。
- **明确记录决策**：wire 契约 `RepoKey` / `repo_key` 与后端 `RepoRef` **默认不改名**（见 Out）。

### Out（本次不做，登记）

- **Tier 2（大改名）**：`worktreeStore` → `workspaceStore` 及其 75 个 import 点、`WorktreeUnitState` 等符号改名。属**纯机械 churn**，另立任务（本文件记录映射表）。
- **Tier 3**：后端 `RepoRef` / `WorktreeRef` / `UnitPath` / `ExecUnit` 改名；wire `repo_key` → `workspace_key`。
  **决策：默认不改** —— `RepoKey` 标的是 `workspace.checkout` 的**身份（属性）**，留着零冲突、零迁移风险；改 wire 需前后端 golden + 兼容期，零功能价值。
- 不改 LSP 协议名（`WorkspaceEdit` / `workspace/workspaceFolders`）与 `${workspaceFolder}`（外部约定）。

## Requirements

### R1 术语表（Tier 0）

- R1.1 术语表有且仅有**一个正文落点**（`docs/domain-model.md`），其余 spec 只链接、不复述。
- R1.2 术语表必须包含：`App` / `Project` / `Workspace` / `workspace.checkout` / `workspace.root` 的定义、基数与归属。
- R1.3 `workspace.root ≡ ${workspaceFolder} ≡ LSP workspace root` 的等价关系必须写明；`RepoKey`/`RepoRef` 注明为 `workspace.checkout` 的身份。

### R2 组件命名（Tier 1）

- R2.1 `ProjectWorkspace.tsx` 重命名为 `ProjectView.tsx`，默认导出与全部 import 点同步。
- R2.2 行为零变更（仅改名 + 引用）。

### R3 「单元根」同义收敛（Tier 2 本批次）

- R3.1 「当前 Workspace 的根」在前端只保留**一个**命令式入口（`activeWorkspaceRoot(projectId)`）与**一个**渲染兜底（`runCwdOf(ctx)`）；删除 `unitRootForProject` 旧名。
- R3.2 `navigate.ts` 的 `resolveUnitRoot` → `workspaceRootFor(...)`；`projectRootOf` → `projectRegisteredRoot(...)`（明确它返回的是**项目登记根**，不是 workspace 根）。
- R3.3 不新增第二套路径归一；全部经 `selectActiveWorktreePath` / `store` 既有单点。

## Acceptance Criteria

1. `pnpm type-check` 与 `pnpm check` 全绿。
2. `ProjectWorkspace` 在 `src/` 内**零命中**（组件已改名，`AppCenter.tsx` 等引用同步）。
3. `unitRootForProject` 在 `src/` 内**零命中**（已收敛为 `activeWorkspaceRoot`）。
4. 术语表仅一处；`git-domain.md` / `state-management.md` / `dap-domain.md` 各增一行**指针**（不复述定义）。
5. 行为零变更：现有 `runner` / `editor` 测试不回归。

## 已知缺口（登记，另立任务）

- `worktreeStore`/`WorktreeUnitState`/`selectActiveWorktreePath` 等 Tier 2 大改名（75 import 点）。
- 后端 `RepoRef`→`CheckoutRef`、`WorktreeRef`→`CheckoutKind`、`ExecUnit` 命名统一；wire `repo_key` 是否改名。
