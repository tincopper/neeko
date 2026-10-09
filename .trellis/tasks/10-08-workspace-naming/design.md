# design — 领域命名收敛（Workspace）

> 配套 `prd.md`。术语决策 + 迁移映射 + 落点。

---

## 1. 术语表（唯一正文，落 `docs/domain-model.md`）

| 术语 | 含义 | 基数 | 归属 |
| --- | --- | --- | --- |
| `App` | 应用进程/窗口；持有当前打开的全部 project（`SessionStore` 持久化其集合与激活态） | 1 | 顶层 |
| `Project` | 逻辑产品；属性：`environment`(Local/WSL/SSH)、agent/ide 配置、主仓登记路径 | 1..N | — |
| `Workspace` | Project 下的一个**独立工作空间**：承载 IDE/Agent/editor/debug/LSP/terminal 状态；**隔离与寻址单位** | 1..N per Project | 中间层 |
| `workspace.checkout` | 该 workspace 的 git 工作副本（**属性**）：`{ path, kind: Main\|Worktree, branch, HEAD }` | 1 per Workspace | 属性 |
| `workspace.root` | 该 workspace 的根目录 = scope 基准 = `${workspaceFolder}` = LSP workspace root | 1 per Workspace | 属性 |

**等价关系（必须写明）**：
- `workspace.root` ≡ DAP `${workspaceFolder}` ≡ LSP `workspace/workspaceFolders` 的项。
- `RepoKey`（TS）/ `RepoRef::key()`（Rust）≡ `workspace.checkout` 的**身份**（属性，不是容器名）。
- LSP `WorkspaceEdit` / `workspace/workspaceFolders` 是**协议名词**，与本领域对象 `Workspace` 命名空间不同，不冲突。

## 2. 分层

```
App
 └ Project                                  (environment、agent/ide 配置、主仓登记路径)
      └ Workspace   kind: Main | Worktree     ← 能力容器 / 隔离边界
           ├ checkout : { path, kind, branch, HEAD }
           ├ root     : 目录（scope 基准）
           └ ide / agent / editor / debug / lsp / terminal
```

## 3. 命名迁移映射（按 Tier）

### Tier 1（本批次）
| 现 | 目标 |
| --- | --- |
| `ProjectWorkspace.tsx`（组件） | `ProjectView.tsx` |

### Tier 2（本批次：runner 侧「单元根」同义收敛）
| 现 | 目标 |
| --- | --- |
| `unitRootForProject(projectId)` | `activeWorkspaceRoot(projectId)`（命令式唯一入口） |
| `resolveRunCwd(ctx)` | `runCwdOf(ctx)`（渲染/执行兜底：`activeWorkspaceRoot ?? ctx.projectPath ?? ''`） |
| `resolveUnitRoot(projectId, fallback)`（navigate） | `workspaceRootFor(projectId, fallback)` |
| `projectRootOf(projectId)`（navigate） | `projectRegisteredRoot(projectId)`（返回**项目登记根**，语义显式） |

### Tier 2（大改名：本任务已落地）
| 现 | 目标 |
| --- | --- |
| `worktreeStore.ts` / `useWorktreeStore` | `workspaceStore.ts` / `useWorkspaceStore` |
| `WorktreeUnitState` | `WorkspaceState` |
| `setActiveWorktree` / `clearActiveWorktree` | `setActiveWorkspace` / `clearActiveWorkspace` |
| `selectActiveWorktreePath` / `getActiveWorktreePath` / `useActiveWorktreePath` | `selectActiveCheckoutPath` / `getActiveCheckoutPath` / `useActiveCheckoutPath` |
| `useActivateRepoUnit` / `useActiveRepoUnitSync` | `useActivateWorkspace` / `useActiveWorkspaceSync` |
| `WorktreeSnapshotItem`（**保留**：它是 git `worktree list` 的条目，属 checkout 元数据） | 不变 |
| `RepoKey` / `repoKeyOf` / `parseRepoKey`（**保留**：checkout 身份） | 不变 |

### Tier 3（本任务已落地：后端类型 + wire 全栈对齐）
| 现 | 目标（已落地） |
| --- | --- |
| `RepoRef` / `WorktreeRef` / `UnitPath` / `ExecUnit` | `WorkspaceRef` / `Checkout` / `CheckoutPath` / `ExecWorkspace` |
| `resolve_repo` / `resolve_unit` / `resolve_unit_root` | `resolve_workspace` / `resolve_exec_workspace` / `resolve_workspace_root` |
| wire `repo_key` / 事件载荷 | `workspace_key` |
| `RepoKey` / `repoKeyOf` / `parseRepoKey` / `unitWorkDir` / `isMainUnit` / `repoKeyLabel` | `WorkspaceKey` / `workspaceKeyOf` / `parseWorkspaceKey` / `workspaceRootOf` / `isMainCheckout` / `workspaceKeyLabel` |
| 文件 `repo_ref.rs` / `unit_path.rs` / `repoRef.ts` | `workspace_ref.rs` / `checkout_path.rs` / `workspaceRef.ts` |

## 4. 落点

| 内容 | 文件 |
| --- | --- |
| 术语表（唯一正文） | `docs/domain-model.md`（新） |
| `RepoRef`/`UnitPath` = checkout 身份/路径（一行指针） | `.trellis/spec/backend/git-domain.md` |
| `worktreeStore` = 当前 Workspace 激活态（一行指针） | `.trellis/spec/frontend/state-management.md` |
| `ExecUnit` = `workspace.root` + environment（一行指针） | `.trellis/spec/backend/dap-domain.md` §2.11 |
| 命令式单元根入口（改名） | `src/features/runner/exec/context.ts` |
| 跳转读取 scope（改名） | `src/features/runner/navigate.ts` |
| 组件改名 | `src/app/components/ProjectView.tsx` + `AppCenter.tsx` 等 14 引用点 |

## 5. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `workspace` 与 LSP 协议名混淆 | 术语表写明「协议命名空间 vs 领域对象」；不改协议名 |
| Tier 2 大改名引入回归 | **本批次不做**，另立任务；本批次只动 runner 侧 4 个同义名（编译期 + 测试兜底） |
| 组件改名漏引用 | `rg ProjectWorkspace src` 归零为验收项 |
