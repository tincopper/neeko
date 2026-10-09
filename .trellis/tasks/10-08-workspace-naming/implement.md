# implement — 领域命名收敛（Workspace）

> 每步完成即跑验证。行为零变更；只改命名与文档。

## 0. 前置

- [ ] 确认 `task.py current` 指向本任务。
- [ ] 读 `design.md` 的 Tier 表与落点表。

## 1. Tier 0 — 术语表（唯一正文）

- [ ] 新增 `docs/domain-model.md`：术语表（App / Project / Workspace / checkout / root）+ 分层图 + 等价关系（`workspace.root ≡ ${workspaceFolder}`；`RepoKey ≡ checkout 身份`；协议名不冲突）。
- [ ] `.trellis/spec/backend/git-domain.md`：加一行指针「`RepoRef`/`UnitPath` = `workspace.checkout` 的身份/路径」→ 链接 `docs/domain-model.md`。
- [ ] `.trellis/spec/frontend/state-management.md`：加一行指针「`worktreeStore` = 当前 `Workspace` 的激活态」。
- [ ] `.trellis/spec/backend/dap-domain.md` §2.11：加一行指针「`ExecUnit` = `workspace.root` + environment」。
- 验证：`docs/domain-model.md` 存在且无死链；其余三处只有指针、无复述。

## 2. Tier 1 — 组件改名

- [ ] `git mv src/app/components/ProjectWorkspace.tsx src/app/components/ProjectView.tsx`。
- [ ] 组件默认导出名 `ProjectWorkspace` → `ProjectView`；更新 `src/app/components/AppCenter.tsx` 的 import/JSX。
- [ ] 更新全部引用点（`rg -l ProjectWorkspace src`，含 `__tests__` mock 路径与用例名）。
- 验证：`rg "ProjectWorkspace" src` **零命中**；`pnpm test:fe src/app` 通过。

## 3. Tier 2（本批次）— runner「单元根」同义收敛

- [ ] `src/features/runner/exec/context.ts`：`unitRootForProject` → `activeWorkspaceRoot`；`resolveRunCwd` → `runCwdOf`。
- [ ] 更新调用点：`runner/languages/io.ts`、`runner/store/debug/sessionSlice.ts`、`runner/store/debug/configSlice.ts`、`runner/store/javaDebugStore.ts`、`runner/exec/launch.ts`、`runner/exec/nativeDebug.ts`。
- [ ] `src/features/runner/navigate.ts`：`resolveUnitRoot` → `workspaceRootFor`；`projectRootOf` → `projectRegisteredRoot`。
- [ ] 更新测试引用：`runner/__tests__/navigate.test.ts`、`runner/hooks/__tests__/useRunActions.test.ts`、`runner/store/debug/__tests__/*`。
- 验证：`rg "unitRootForProject|resolveRunCwd|resolveUnitRoot|projectRootOf" src` **零命中**；`pnpm test:fe src/features/runner` 通过。

## 4. 收尾

- [ ] `pnpm type-check`；`pnpm lint`（`lint_fe`）。
- [ ] `pnpm check`（含护栏）全绿。
- [ ] `rg "ProjectWorkspace" src` 与 `rg "unitRootForProject" src` 均零命中。
- [ ] 记录会话。

## 依赖顺序

Tier 0（文档，独立）→ Tier 1（组件）→ Tier 2（runner 命名）。三者互不阻塞，但按序做便于逐步验证。

## 明确不做（另立任务）

- `worktreeStore` 大改名（75 import 点）与 `WorktreeUnitState` 等符号。
- 后端 `RepoRef`/`WorktreeRef`/`UnitPath`/`ExecUnit` 改名与 wire `repo_key` 改名（决策：默认不改）。

## 落地记录（2026-10-08）

1. **Tier 0 已落地**：新增 `docs/domain-model.md`（术语唯一定义处）；`git-domain.md §12`、
   `state-management.md`（store 表后）、`dap-domain.md §2.11` 各加一行**指针**（不复述定义）。
2. **Tier 1 已落地**：`git mv ProjectWorkspace.tsx → ProjectView.tsx`；全仓 14 处文本引用
   （含注释与测试 mock 路径/用例名）同步；`rg ProjectWorkspace` 在 `src`/`spec`/`docs` 归零。
3. **Tier 2（本批次）已落地**：
   - `exec/context.ts`：`unitRootForProject → activeWorkspaceRoot`、`resolveRunCwd → runCwdOf`。
   - `navigate.ts`：`resolveUnitRoot → workspaceRootFor`、`projectRootOf → projectRegisteredRoot`。
   - 更新全部调用点（io/sessionSlice/configSlice/javaDebugStore/launch/nativeDebug + 语言模块）
     与 `dap-domain.md` 的护栏行。
4. **护栏台账同步**：`tools/guards/ledger/component_size.json` 的基线键
   `.../ProjectWorkspace.tsx` → `.../ProjectView.tsx`（值不变，避免改名被当作“新文件越线”）。
5. **验证**：`pnpm type-check` 通过；`pnpm test:fe src/app src/features/runner` 809 用例通过；
   `pnpm check` 22/22 护栏通过。
6. **未做（登记，另立任务）**：`worktreeStore`/`WorktreeUnitState` 等 Tier 2 大改名（75 import 点）；
   后端 `RepoRef`/`WorktreeRef`/`UnitPath`/`ExecUnit` 改名；wire `repo_key → workspace_key`（决策：默认不改）。

## Tier 2 大改名落地记录（并入本任务，2026-10-08）

符号（前端，跨 78 文件）：
- `worktreeStore.ts` → `workspaceStore.ts`；`useWorktreeStore` → `useWorkspaceStore`；
  `WorktreeUnitState` → `WorkspaceState`；`WorktreeStoreState` → `WorkspaceStoreState`。
- `setActiveWorktree` → `setActiveWorkspace`；`clearActiveWorktree` → `clearActiveWorkspace`；
  `markWorktreeOpened` → `markWorkspaceOpened`；`selectWorktreeStateOf` → `selectWorkspaceStateOf`。
- `selectActiveWorktreePath` → `selectActiveCheckoutPath`；`getActiveWorktreePath` → `getActiveCheckoutPath`；
  `useActiveWorktreePath` → `useActiveCheckoutPath`；`useActiveWorktreeBranch` → `useActiveCheckoutBranch`；
  `useActiveWorktree` → `useActiveWorkspace`。
- `useActivateRepoUnit` → `useActivateWorkspace`（文件同步改名）；`useActiveRepoUnitSync` → `useActiveWorkspaceSync`（文件同步改名）。
- **保留**（checkout 身份/属性，非容器名）：`WorktreeSnapshotItem`、`RepoKey`、`repoKeyOf`、`parseRepoKey`、
  `isMainUnit`、`selectActiveRepoKey`、`activeRepoKeyOf`、`useActiveRepoKey`。

护栏/测试/文档同步：
- `tools/guards/checks/check_repo_unit_identity.py`：`STORE_STATE_ALLOWLIST` → `workspaceStore.ts`；
  镜像判据的 store 名 token 增加 `workspaceStore`/`WorkspaceStore`；文案更新。
- `tools/guards/tests/test_check_repo_unit_identity.py`：夹具路径/符号更新（selftest 392 通过）。
- 测试文件改名：`__tests__/worktreeStore.test.ts` → `workspaceStore.test.ts`；
  `useActivateRepoUnit.test.ts` → `useActivateWorkspace.test.ts`；`useActiveRepoUnitSync.test.ts` → `useActiveWorkspaceSync.test.ts`。
- spec/docs：`state-management.md` 等引用同步；`docs/domain-model.md` 更新「未完成」台账。

验证：`pnpm type-check` ✓；`pnpm test:fe`（相关 58 文件）✓；`pnpm check` 全绿（见会话记录）。

## 仍不做（登记）
- Tier 3：后端 `RepoRef`/`WorktreeRef`/`UnitPath`/`ExecUnit` 改名；wire `repo_key → workspace_key`（决策：默认不改）。

## Tier 3 全栈对齐落地记录（2026-10-08）

后端（Rust）：
- 类型：`RepoRef` → `WorkspaceRef`；`WorktreeRef` → `Checkout`；`UnitPath` → `CheckoutPath`；`ExecUnit` → `ExecWorkspace`。
- 函数：`resolve_repo` → `resolve_workspace`；`resolve_unit` → `resolve_exec_workspace`；
  `resolve_unit_root` → `resolve_workspace_root`；私有 `unit_root` → `workspace_root`。
- 文件：`common/git/repo_ref.rs` → `workspace_ref.rs`；`common/git/unit_path.rs` → `checkout_path.rs`。
- wire：所有 `repo_key` 字段/局部/事件载荷 → `workspace_key`（`repo_key_prefix` cache 前缀保持不变，它是 cache key 不是身份）。

前端（TS）：
- `RepoKey` → `WorkspaceKey`；`repoKeyOf` → `workspaceKeyOf`；`parseRepoKey` → `parseWorkspaceKey`；
  `repoKeyLabel` → `workspaceKeyLabel`；`REPO_KEY_SEP` → `WORKSPACE_KEY_SEP`；
  `unitWorkDir` → `workspaceRootOf`；`isMainUnit` → `isMainCheckout`；`RepoStatus` → `WorkspaceStatus`。
- 文件：`shared/utils/repoRef.ts` → `workspaceRef.ts`（测试同名）。
- 事件载荷/类型字段 `repo_key` → `workspace_key`（`GitStatusSnapshot` / `GitChangedEvent` / `FileChangedEvent` / `FileTreeChangedEvent`）。

护栏/文档同步：
- `check_blocking_fs_in_commands.py`：判据正则 `UnitPath::resolve(` → `CheckoutPath::resolve(`、`RepoRef::resolve(` → `WorkspaceRef::resolve(`；测试夹具同步。
- `check_repo_unit_identity.py`：`KEY_MATERIAL_ALLOWLIST` / `FE_ALLOWLIST` 路径与 `KEY_MATERIAL_CONTEXT_RE` 词表更新；
  `invariants.json` 标题、`check_service_no_delivery_dep.py` 文案同步。
- spec/docs 全量替换（`git-domain.md` / `state-management.md` / `dap-domain.md` / `type-safety.md` / `docs/domain-model.md` 等）。
- `useBrowserTab.ts` 因改名换行回涨 2 行触发 `check_component_size` ratchet → 改为 early-return 复原基线 301。

验证：`cargo check --tests` ✓；`pnpm type-check` ✓；`pnpm check` 22/22 护栏通过（含 `test_rust` / `test_fe` / `test_host`）。

## neeko-check 复核残留修复记录（2026-10-08）

**问题（Block）**：类型/身份/wire 字段已对齐，但 `unit`/`repo` 术语仍残留在命令名、函数名、日志、局部变量、注释。

修复：
1. **wire 命令**：`get_repo_status` → `get_workspace_status`；`set_active_repo_unit` → `set_active_workspace`
   （`lib.rs` 注册 + `gitApi` wrapper（`getWorkspaceStatus` / `activateWorkspace`）+ 全部调用点 + `ProjectCommands` 工厂）。
2. **后端函数**：`release_unit` → `release_workspace`；`read_unit_status` → `read_workspace_status`。
3. **属性访问器**：`WorkspaceRef::work_dir()` / `work_dir_path()` / `work_dir_pathbuf()` → `root()` / `root_path()` / `root_pathbuf()`
   （对齐 `workspace.root`；44 处调用点同步）。
4. **前端**：`WorktreeSnapshotItem` → `CheckoutEntry`；`resolveRepoRelativePath` → `resolveWorkspaceRelativePath`；
   局部变量 `unitRoot`/`unitPath`/`unitWorktreePath`/`unitBranch`/`unitWorkspaceKey` → workspace/checkout 命名；
   log/source `repo-unit-sync` → `workspace-sync`；用户可见文案 `unit` → `workspace`。
5. **后端生产代码**：`dap/*` 的 `ExecWorkspace` 局部/形参 `unit` → `exec`；`git/services/status.rs`、`git/commands/worktree.rs`、
   watcher manager/git_meta 的 `unit` → `workspace`；日志/注释/en-US 文案同步。
6. **护栏**：`check_repo_unit_identity` → `check_workspace_identity`（文件 + `GUARD.id` + 测试文件 + `invariants.json` 三处 ref +
   `src-tauri/AGENTS.md`）；`STATUS_INVOKE_RE` 词表更新为 `workspace_status|active_workspace`；
   `KEY_MATERIAL_ALLOWLIST`/`FE_ALLOWLIST` 路径与 `KEY_MATERIAL_CONTEXT_RE` 同步。
7. **racy ratchet**：`useAppShellData.ts` 因改名换行回涨 → 收敛回 409（基线 410）。

验证：`cargo check --tests` ✓；`pnpm type-check` ✓；`pnpm check` 22/22 护栏通过。
最终旧名核验（全仓）：`RepoRef`/`RepoKey`/`repoKey`/`repo_key`/`WorktreeRef`/`UnitPath`/`ExecUnit`/
`get_repo_status`/`set_active_repo_unit`/`read_unit_status`/`release_unit`/`WorktreeSnapshotItem`/`check_repo_unit_identity`
**零命中**（`repo_key_prefix` 为 cache 键前缀，刻意保留）。

## 第四遍复核（概念边界）修复记录（2026-10-08）

按边界规则「`worktree` 只命名 git 原生事物；容器/激活/状态用 `Workspace`/`checkout`」：
- `useWorktreeState` → `useWorkspaceState`（文件同步改名）；`activateWorktree` → `activateWorkspace`。
- `activeWorktreePath` → `activeCheckoutPath`；`activeWorktreeBranch` → `activeCheckoutBranch`；`openedWorktrees` → `openedCheckouts`。
- `activeWslWorktreePath`/`activeRemoteWorktreePath` → `activeWslCheckoutPath`/`activeRemoteCheckoutPath`。
- `WorktreeItem` 删除（与 `workspaceStore.CheckoutEntry` 同形重复）→ 统一用 `CheckoutEntry`（DRY）。
- 保留（git 原生/持久化）：`isActiveWorktree`（是否为 linked checkout 的**类型谓词**）、
  `create/remove/rename_worktree`、`canonicalWorktreePath`、`isWorktreeDirty`、`WorktreeList`、
  `saveWorktreeState`/`restoreWorktreeState`（持久化字段 `worktree_state`，改名需 serde alias 迁移）。
- 历史注释保留：`activeWorktreePath` 作为「已删除的 store 镜像字段」在 `workspaceStore.ts`/`useProjectActions.ts`/
  `state-management.md` 的说明（记录「为什么删」）—— 改用时须区分「当前 prop」与「历史提及」。
- 测试卫生：`useSingletonDiff.test.ts`/`useOpenStashDiff.test.ts` 原来 `setState({ activeWorktreePath, activeWorktreeBranch })`
  是 **no-op**（store 无此字段）→ 改为 `setActiveWorkspace(...)` / `{ byProject: {} }`（真实的激活态复位）。
- 测试夹具目录字面量 `"unit"` → `"ws"`。

验证：`pnpm type-check` ✓；`pnpm check` 22/22 护栏通过（`test_fe`/`test_rust`/`test_host` 全绿）。

## 复核方法论沉淀（可复用）

命名收敛的**边界规则**：一个词只命名一类事物 —— `Workspace`=容器、`checkout`=git 属性（路径/分支/kind）、
`worktree`=仅 git 原生（`git worktree` 操作、其清单条目、linked-vs-main 类型谓词）。判定新符号时用此规则，
不与历史已删除符号（如 `activeWorktreePath` 镜像）混淆。
