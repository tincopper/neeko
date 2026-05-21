# 架构优化实施方案

> 生成日期：2026-05-21
> 分支：`refactor/architecture-optimization`
> 技术方案：见 `docs/architecture-optimization-plan.md`

---

## 执行总览

```
Phase 0 ─── 基础设施准备（1-2天）
  │
Phase 1 ─── P0 快速收益：SSH 认证 + Theme 编排（2-3天，可并行）
  │
Phase 2 ─── P1 前端基础清理：Prop 塌缩 Phase 1-2 + useAppContainer 拆分（3-5天）
  │
Phase 3 ─── P1 前端深度重构：Terminal 视图合并 + Prop 塌缩 Phase 3-4（4-6天）
  │
Phase 4 ─── P2 Store 切片拆分（3-4天）
  │
Phase 5 ─── P2 Git 操作统一（5-8天）
```

---

## Phase 0：基础设施准备

**目标：** 确保重构安全网就位。

### 任务清单

| # | 任务 | 说明 | 验证 |
|---|---|---|---|
| 0.1 | 运行全量测试基线 | `pnpm test` + `cargo test --manifest-path src-tauri/Cargo.toml`，记录当前通过率 | 所有测试通过，记录数量 |
| 0.2 | 前端类型检查基线 | `npx tsc --noEmit` | 零 error |
| 0.3 | Rust 编译检查基线 | `cargo check --manifest-path src-tauri/Cargo.toml` | 零 error |
| 0.4 | 确认 dev 模式可启动 | `pnpm tauri dev`，验证本地/WSL/Remote 三种终端基本操作 | 终端可打开，git 面板可刷新 |

**每个 Phase 结束时重跑 0.1-0.3，确保无回归。**

---

## Phase 1：P0 快速收益

两个任务完全独立，可并行执行。

### 1A：SSH 认证整合

**涉及文件：**
- 新建：`src-tauri/src/utils/command/ssh_auth.rs`
- 修改：`src-tauri/src/utils/command/mod.rs`（添加 `pub mod ssh_auth`）
- 修改：`src-tauri/src/remote.rs`（3 处替换）
- 修改：`src-tauri/src/utils/command/ssh.rs`（1 处替换）

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 创建 `ssh_auth.rs`，编写 `authenticate()` 和 `connect_and_authenticate()` 函数 | `cargo check` |
| 2 | 在 `ssh_auth.rs` 中编写测试（mock transport 或使用 `#[cfg(test)]` 模块） | `cargo test ssh_auth` |
| 3 | 在 `utils/command/mod.rs` 中添加 `pub mod ssh_auth` | `cargo check` |
| 4 | 重构 `remote.rs::create_session()` 第 72-95 行 → 调用 `ssh_auth::connect_and_authenticate()` | `cargo check` |
| 5 | 重构 `remote.rs::test_connection()` 第 302-325 行 | `cargo check` |
| 6 | 重构 `remote.rs::list_directories()` 第 362-385 行 | `cargo check` |
| 7 | 重构 `utils/command/ssh.rs::exec_command()` 第 52-71 行 | `cargo check` |
| 8 | 全量 Rust 测试 | `cargo test` |

**回滚：** 每步都是独立的 `cargo check` 验证点，任何步骤失败可 `git checkout` 该文件。

**预期产出：** 删除 ~80 行，新增 ~40 行，净减 ~40 行。

---

### 1B：Theme 安装编排

**涉及文件：**
- 新建：`src-tauri/src/theme/mod.rs`、`theme/common.rs`
- 移动：`opencode_theme.rs` → `theme/opencode.rs`，`pi_theme.rs` → `theme/pi.rs`
- 修改：`src-tauri/src/lib.rs`（模块声明）
- 修改：`src-tauri/src/app.rs`（2 行）
- 修改：`src-tauri/src/terminal.rs`（~10 行）
- 修改：`src-tauri/src/remote.rs`（~80 行）
- 修改：`src-tauri/src/commands/config.rs`（~40 行）

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 创建 `theme/` 目录 | — |
| 2 | 创建 `theme/common.rs`，提取 `map_theme_name()`、`base64_encode()`、`shell_escape()`、`read_neeko_theme()` | `cargo check` |
| 3 | 移动 `opencode_theme.rs` → `theme/opencode.rs`，更新内部 import 使用 `common::` | `cargo check` |
| 4 | 移动 `pi_theme.rs` → `theme/pi.rs`，更新内部 import 使用 `common::` | `cargo check` |
| 5 | 更新 `lib.rs` 模块声明：删除 `mod opencode_theme` + `mod pi_theme`，添加 `pub mod theme` | `cargo check` |
| 6 | 更新所有外部引用：`crate::opencode_theme::` → `crate::theme::opencode::`，`crate::pi_theme::` → `crate::theme::pi::` | `cargo check` |
| 7 | 创建 `theme/mod.rs`，添加 `ThemeContext` enum 和 `install_all_global_themes()`、`write_project_theme_config()` | `cargo check` |
| 8 | 简化 `app.rs` 调用 | `cargo check` |
| 9 | 简化 `terminal.rs` 调用（local + WSL） | `cargo check` |
| 10 | 简化 `remote.rs` 调用 | `cargo check` |
| 11 | 简化 `commands/config.rs` 调用 | `cargo check` |
| 12 | 全量 Rust 测试 | `cargo test` |

**回滚：** 步骤 1-6 是纯粹的文件重组（无行为变更），可安全回滚。步骤 7-11 是简化调用。

**预期产出：** 删除 ~200 行重复代码，`read_neeko_theme()` 合并为一处。

---

## Phase 2：P1 前端基础清理

### 2A：Prop 塌缩 Phase 1-2（零风险 + 低风险）

**涉及文件：**
- `src/components/layout/EditorGroupPane.tsx`
- `src/components/layout/EditorGroupLayout.tsx`
- `src/components/MainContent.tsx`

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 删除 `tabKey` prop（从未解构，死代码） | `npx tsc --noEmit` |
| 2 | 删除 `onToggleHiddenAgent` prop（从未使用，死代码） | `npx tsc --noEmit` |
| 3 | EditorGroupPane 内部调用 `useEditorContext()` 获取：`agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onAgentClick` | `npx tsc --noEmit` |
| 4 | EditorGroupPane 内部调用 `useAppContext()` 获取：`config`, `showToast` | `npx tsc --noEmit` |
| 5 | 从 `EditorGroupPaneProps` 接口删除上述 8 个 prop | `npx tsc --noEmit` |
| 6 | 从 `EditorGroupLayout` 的 `sharedPaneProps` 中删除对应字段 | `npx tsc --noEmit` |
| 7 | 从 `MainContent.tsx` 中删除对应传递 | `npx tsc --noEmit` |
| 8 | Phase 2：EditorGroupPane 接收 `tabKey` 作为显式 prop（恢复，但作为 hook 输入） | `npx tsc --noEmit` |
| 9 | EditorGroupPane 调用 `useEditorGroupLayout(tabKey)` 直接读取 `tabs`, `activeTabId`, `pinnedTabId`, `isFocused` | `npx tsc --noEmit` |
| 10 | EditorGroupPane 内联 store action 调用替代 `onActivateTab`, `onCloseTab` 等 prop | `npx tsc --noEmit` |
| 11 | 从 `EditorGroupPaneProps` 删除 Phase 2 的 10 个 prop | `npx tsc --noEmit` |
| 12 | 前端全量测试 + 类型检查 | `pnpm test && npx tsc --noEmit` |

**预期产出：** Props 从 25+ → 8-10，删除 `sharedPaneProps` 中的大部分字段。

---

### 2B：useAppContainer 拆分（Bag 1 + Bag 3 + Bag 4）

**涉及文件：**
- 新建：`src/hooks/useTitleBarProps.ts`、`src/hooks/useAppLayoutProps.ts`、`src/hooks/useAppModalsProps.ts`
- 修改：`src/hooks/useAppContainer.ts`（逐步瘦身）
- 修改：`src/App.tsx`

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 创建 `useAppLayoutProps.ts`，从 useAppContainer 提取 Bag 3 逻辑 | `npx tsc --noEmit` |
| 2 | App.tsx 使用 `useAppLayoutProps()` 替代 `appLayoutProps` | `pnpm test && npx tsc --noEmit` |
| 3 | 创建 `useTitleBarProps.ts`，从 useAppContainer 提取 Bag 1 逻辑（含 `handleTitleBarRefreshGit`、`handleTitleBarCheckoutBranch`、`isBranchSwitching`） | `npx tsc --noEmit` |
| 4 | App.tsx 使用 `useTitleBarProps()` 替代 `titleBarProps` | `pnpm test && npx tsc --noEmit` |
| 5 | 将 `wsl.onAddWslEntry` 中的 post-add git refresh 移入 `useWslProjects` 或 modal 组件内部 | `npx tsc --noEmit` |
| 6 | 将 `remote.onAddRemoteEntry` 中的 post-add git refresh 移入 `useRemoteProjects` 或 modal 组件内部 | `npx tsc --noEmit` |
| 7 | 创建 `useAppModalsProps.ts`，从 useAppContainer 提取 Bag 4 逻辑 | `npx tsc --noEmit` |
| 8 | App.tsx 使用 `useAppModalsProps()` 替代 `appModalsProps` | `pnpm test && npx tsc --noEmit` |
| 9 | 前端全量测试 + 类型检查 | `pnpm test && npx tsc --noEmit` |

**预期产出：** useAppContainer 从 757 行 → ~400 行（只剩 Bag 2 + bootstrap + keyboard shortcuts）。

---

## Phase 3：P1 前端深度重构

### 3A：Terminal 视图合并

**涉及文件：**
- 新建：`src/components/terminal/strategies/types.ts`、`strategies/local.ts`、`strategies/wsl.ts`、`strategies/remote.ts`
- 新建：`src/components/terminal/TerminalViewBase.tsx`
- 修改：`src/components/terminal/terminalCache.ts`（统一 cache 类型）
- 重写：`RemoteTerminalView.tsx`（269→~30行）、`WSLTerminalView.tsx`（262→~30行）
- 重构：`TerminalView.tsx`（保留 task-terminal 特殊逻辑）

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 创建 `strategies/types.ts`，定义 `SessionStrategy` 和 `SessionContext` 接口 | `npx tsc --noEmit` |
| 2 | 创建三个策略文件：`local.ts`、`wsl.ts`、`remote.ts` | `npx tsc --noEmit` |
| 3 | 统一 `terminalCache.ts` 中的 cache 类型为 `UnifiedTerminalCache`（`listeners: (() => void)[]` 替代分散的 unlisten 字段） | `npx tsc --noEmit` + `pnpm test` |
| 4 | 创建 `TerminalViewBase.tsx`，实现统一的 xterm 初始化、ResizeObserver、attach/detach、agent launch | `npx tsc --noEmit` |
| 5 | 先迁移 `WSLTerminalView.tsx` 为 `TerminalViewBase` 适配器，验证 WSL 终端功能 | 手动测试 WSL 终端 |
| 6 | 迁移 `RemoteTerminalView.tsx` 为适配器，验证 SSH 终端功能 | 手动测试 SSH 终端 |
| 7 | 迁移 `TerminalView.tsx`（local），保留 task-terminal、agentCommandOverride、terminal-closed 特殊逻辑 | 手动测试本地终端 + task terminal |
| 8 | 删除旧的重复代码 | `npx tsc --noEmit` + `pnpm test` |
| 9 | 前端全量测试 | `pnpm test && npx tsc --noEmit` |

**回滚：** 步骤 5-7 每步都是独立迁移，可单独回滚。新旧组件可共存。

**预期产出：** 删除 ~400 行重复代码，三个视图分别从 269/262/358 行 → ~30 行。

---

### 3B：Prop 塌缩 Phase 3-4

**涉及文件：**
- `src/components/layout/EditorGroupPane.tsx`
- `src/components/terminal/TerminalView.tsx`（或其适配器）
- `src/components/DiffView.tsx`
- `src/components/MainContent.tsx`

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 让 TerminalView/DiffView 子组件接收 `tabKey` + `groupId` 作为 props，自行从 store 读取 `activeTabId` | `npx tsc --noEmit` |
| 2 | 删除 EditorGroupPane 的 local `EditorProvider` overlay 机制 | `npx tsc --noEmit` |
| 3 | 删除 `onAddTerminalTab`、`onCloseOtherTabs`、`onCloseAllTabs` props | `npx tsc --noEmit` |
| 4 | `wslProject` 从 `useWslContext().activeWslProject` 直接读取 | `npx tsc --noEmit` |
| 5 | 删除 `sharedPaneProps` 对象，EditorGroupLayout 直接传递 5 个 instance props | `npx tsc --noEmit` |
| 6 | 前端全量测试 | `pnpm test && npx tsc --noEmit` |

**预期产出：** Props 从 8-10 → 5，`sharedPaneProps` 完全删除。

---

## Phase 4：P2 Store 切片拆分

**涉及文件：**
- 新建：`src/store/slices/project.ts`、`connection.ts`、`worktree.ts`、`tabEditor.ts`、`fileView.ts`、`git.ts`
- 重构：`src/store/appStore.ts`（822行 → 组合 6 个 slice）
- 删除：`src/hooks/useSyncToStore.ts`
- 修改：`src/hooks/useWslProjects.ts`、`useRemoteProjects.ts`、`useRemoteAuthActions.ts`（`useState` → store）

**执行步骤：**

| 步骤 | 操作 | 验证 |
|---|---|---|
| 1 | 创建 `store/slices/` 目录 | — |
| 2 | 将 `appStore.ts` 中的 state + action 按域搬入 6 个 slice 文件（纯重组，无行为变更） | `npx tsc --noEmit` + `pnpm test` |
| 3 | `appStore.ts` 改为组合模式：`create<AppState>()((...a) => ({ ...createProjectSlice(...a), ... }))` | `npx tsc --noEmit` + `pnpm test` |
| 4 | 将 `useWslProjects` 的 `useState` 迁移为直接读写 `connectionSlice` | `npx tsc --noEmit` |
| 5 | 将 `useRemoteProjects` 的 `useState` 迁移为直接读写 `connectionSlice` | `npx tsc --noEmit` |
| 6 | 将 `useRemoteAuthActions` 的 `useState` 迁移为直接读写 `connectionSlice` | `npx tsc --noEmit` |
| 7 | 删除 `useSyncToStore.ts` | `npx tsc --noEmit` |
| 8 | 删除 appStore 中的 noop action（`selectProject` 等） | `npx tsc --noEmit` |
| 9 | 将 `handleSelectProjectWithClear` 等跨域操作移入 `store/orchestrator.ts` | `npx tsc --noEmit` |
| 10 | 前端全量测试 | `pnpm test && npx tsc --noEmit` |

**回滚：** 步骤 2-3 是纯重组（同一个 Zustand store，只是文件结构变了），极其安全。步骤 4-7 是状态归属迁移，每步独立可验证。

**预期产出：** 822 行 → 6 个 ~60-250 行 slice，删除 `useSyncToStore`（89 行）。

---

## Phase 5：P2 Git 操作统一

这是最大、最复杂的重构，分 6 个子阶段。

**涉及文件：**
- 新建：`git/transport.rs`、`git/operations.rs`、`git/status.rs`、`git/staging.rs`、`git/branching.rs`、`git/worktree_ops.rs`、`git/history.rs`、`git/parsers.rs`
- 新建：`commands/git_unified.rs`
- 删除：`git/local.rs`、`git/wsl.rs`、`git/remote.rs`、`commands/git.rs`、`commands/wsl_git.rs`、`commands/remote_git.rs`
- 修改：前端所有 `invoke("xxx_command")` 调用（~50 处）

**执行步骤：**

| 步骤 | 操作 | 验证 | 天数 |
|---|---|---|---|
| **5.1** | 创建 `git/parsers.rs`，将 `parse_unified_diff`、`collapse_diff_context`、`parse_git_info_output`、`parse_commit_log_output`、`build_file_tree_from_find` 统一迁移（目前分散在 local.rs 和 remote.rs） | `cargo test` | 0.5 |
| **5.2** | 创建 `git/transport.rs`，定义 `GitTransport` trait + `LocalTransport`、`WslTransport`、`RemoteTransport` 三个实现 | `cargo test`（单元测试 mock transport） | 1 |
| **5.3** | 创建 `git/operations.rs`，从最简单的操作开始：`stage_files`、`unstage_files`、`commit`、`fetch`、`push`、`pull`（这些在三个模块中已经 100% shell） | `cargo test` | 1 |
| **5.4** | 继续迁移 `git/operations.rs`：worktree CRUD、branching（6 个 git2 函数转换为 shell 或保留 git2 快速路径）、history、cherry-pick/revert/tag | `cargo test` | 1.5 |
| **5.5** | 创建 `commands/git_unified.rs`，定义 `GitTransportKind` enum + 统一 command 函数。逐个迁移前端 invoke 调用（每次迁移一个函数，前端和后端同时切换） | `cargo test` + `npx tsc --noEmit` + 手动测试 | 2-3 |
| **5.6** | 删除旧文件：`git/local.rs`、`git/wsl.rs`、`git/remote.rs`、`commands/git.rs`、`commands/wsl_git.rs`、`commands/remote_git.rs` | `cargo test` + `cargo check` | 0.5 |

**子阶段 5.5 迁移顺序建议（从最简单到最复杂）：**

```
Batch 1 (shell-only, 最简单):
  stage_files → unstage_files → commit → fetch → push → pull → cherry_pick → revert → create_tag

Batch 2 (worktree):
  create_worktree → remove_worktree → rename_worktree → is_worktree_dirty

Batch 3 (branching):
  checkout_branch → create_branch → rename_branch → delete_branch

Batch 4 (status/info, 需处理 git2 快速路径):
  get_git_info → get_file_diff → get_commit_log → get_commit_detail → get_commit_files → get_ahead_behind
```

**每个函数迁移的 5 步操作：**
1. `git/operations.rs` — 新实现（通过 GitTransport trait）
2. `commands/git_unified.rs` — 新 command
3. `commands/mod.rs` — 注册新 command
4. 前端 `invoke()` — 切换到新 command 名称
5. 删除旧的三路函数（local + wsl + remote）

**回滚：** 每个函数的迁移都是独立的。新旧 command 可共存（不同 invoke 名称），前端逐个切换。任何函数迁移失败不影响已迁移的函数。

**预期产出：** 删除 ~2,500 行重复代码。`commands/` 从 3 个文件 2,520 行 → 1 个文件 ~300 行。`git/` 从 3 个文件 3,300 行 → 1 个 `operations.rs` ~800 行 + 6 个分域模块。

---

## 风险控制

### 每个 Phase 的验证清单

```bash
# Phase 结束时必须全部通过
npx tsc --noEmit                                    # 前端类型检查
pnpm test                                           # 前端测试
cargo check --manifest-path src-tauri/Cargo.toml    # Rust 编译
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 测试
pnpm tauri dev                                      # 手动冒烟测试（终端、git、WSL、SSH）
```

### 回滚策略

| Phase | 风险等级 | 回滚方式 |
|---|---|---|
| Phase 1 (1A + 1B) | 低 | 每步独立 `cargo check` 验证，失败即 `git checkout` 单文件 |
| Phase 2 (2A + 2B) | 低 | 每步 `npx tsc` 验证，类型错误即回滚 |
| Phase 3 (3A) | 中 | 新旧组件可共存，逐个迁移，失败回滚单组件 |
| Phase 3 (3B) | 中 | 依赖 Phase 2 完成，每步 `npx tsc` 验证 |
| Phase 4 | 中 | 步骤 2-3 是文件重组（API 不变），步骤 4-7 每步独立 |
| Phase 5 | 高 | 新旧 command 共存，前端逐个切换 invoke，失败回滚单函数 |

### 时间估算

| Phase | 估算天数 | 可并行 | 备注 |
|---|---|---|---|
| Phase 0 | 0.5 | — | 基线记录 |
| Phase 1 (1A + 1B) | 2-3 | 1A 和 1B 可并行 | 纯后端，互不影响 |
| Phase 2 (2A + 2B) | 3-5 | 2A 和 2B 可并行 | 纯前端 |
| Phase 3 (3A + 3B) | 4-6 | 3B 依赖 3A 完成 | 需手动测试终端 |
| Phase 4 | 3-4 | — | Store 重组，需全量回归 |
| Phase 5 | 5-8 | — | 最大重构，需前后端联调 |
| **总计** | **18-27 天** | 乐观 ~15 天 | 含测试和手动验证 |

---

## 附录：关键指标追踪

### 代码量变化（预期）

| 指标 | 当前 | Phase 1 后 | Phase 2 后 | Phase 3 后 | Phase 4 后 | Phase 5 后 |
|---|---|---|---|---|---|---|
| 后端总行数 | ~19,675 | ~19,395 | ~19,395 | ~19,395 | ~19,395 | ~17,095 |
| 前端总行数 | ~13,000 | ~13,000 | ~12,370 | ~11,970 | ~11,880 | ~11,880 |
| `useAppContainer` | 757 | 757 | ~400 | ~400 | ~400 | ~400 |
| `appStore` | 822 | 822 | 822 | 822 | ~6 个 slice | ~6 个 slice |
| `EditorGroupPane` props | 25+ | 25+ | 8-10 | 5 | 5 | 5 |
| `git/local.rs` | 1994 | 1994 | 1994 | 1994 | 1994 | 删除 |
| 重复 git commands | 3 文件 2,520行 | 3 文件 2,520行 | 3 文件 2,520行 | 3 文件 2,520行 | 3 文件 2,520行 | 1 文件 ~300行 |
