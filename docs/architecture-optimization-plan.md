# Neeko 架构深度优化 — 技术方案总集

> 生成日期：2026-05-21
> 分支：`refactor/architecture-optimization`
> 方法论：基于 Deep Modules 理论的架构审查，通过 Deletion Test、Interface Leverage、Locality 评估

---

## 总览

本方案识别了 7 个深度优化机会，涵盖后端 Rust 模块（~19,675 行）和前端 React/TypeScript（~5,998 行 hooks + 822 行 store）。核心问题是**重复代码**、**浅模块**和**跨域耦合**。

### 优先级矩阵

| # | 方案 | 预计删除行数 | 风险 | 复杂度 | 建议优先级 |
|---|---|---|---|---|---|
| 5 | SSH 认证整合 | ~80 | 低 | 低 | **P0**（快速收益） |
| 6 | Theme 安装编排 | ~200 | 低 | 低 | **P0**（快速收益） |
| 7 | Prop 传递塌缩 | ~150 | 低→中 | 低→中 | **P1**（Phase 1-2 立即可做） |
| 3 | useAppContainer 拆分 | ~300 | 中 | 中 | **P1** |
| 2 | Terminal 视图合并 | ~400 | 中 | 中 | **P1** |
| 4 | appStore 切片拆分 | ~100 + 删除 useSyncToStore | 中 | 中高 | **P2** |
| 1 | Git 操作统一 | ~2,500 | 中高 | 高 | **P2**（最大收益，最高风险） |

**建议执行顺序：5 → 6 → 7(Phase 1-2) → 3 → 2 → 7(Phase 3-4) → 4 → 1**

---

## 方案一：Git 操作统一

### 现状诊断

| 层 | 文件 | 行数 | 函数数 | 实现方式 |
|---|---|---|---|---|
| Command (Local) | `commands/git.rs` | 765 | 38 | → `git/local.rs` |
| Command (WSL) | `commands/wsl_git.rs` | 930 | 30 | → `git/wsl.rs` |
| Command (Remote) | `commands/remote_git.rs` | 825 | 30 | → `git/remote.rs` |
| Impl (Local) | `git/local.rs` | 1994 | 40 | git2(6个) + shell(34个) |
| Impl (WSL) | `git/wsl.rs` | 457 | 15 | 100% shell |
| Impl (Remote) | `git/remote.rs` | 849 | 14 | 100% shell |
| **合计** | | **5,820** | | |

**关键发现：** `local.rs` 中只有 6 个函数使用 git2（`get_git_info`、`get_changed_files`、`get_git_branch_info`、`checkout_branch`、`create_branch`、`rename_branch`），其余 34 个已经是 shell。WSL 是同步的，Remote 是异步的。

**Triplication Map（25 个重复操作）：**

| 类别 | 操作 | Local | WSL | Remote |
|---|---|---|---|---|
| STATUS | get_git_info | git2 | shell | shell |
| STATUS | get_file_diff | shell/git2 | shell | shell |
| WORKTREE | create_worktree | shell | shell | shell |
| WORKTREE | remove_worktree | shell | shell | shell |
| WORKTREE | rename_worktree | shell | shell | shell |
| WORKTREE | get_worktree_changed_files | git2 | shell | shell |
| WORKTREE | is_worktree_dirty | shell | shell | shell |
| BRANCH | checkout_branch | git2 | shell | shell |
| BRANCH | create_branch | git2 | shell | shell |
| BRANCH | rename_branch | git2 | shell | shell |
| STAGING | stage_files | shell | shell | shell |
| STAGING | unstage_files | shell | shell | shell |
| STAGING | discard_file | shell | shell | shell |
| COMMIT | commit_files | shell | shell | shell |
| REMOTE | fetch | shell | shell | shell |
| REMOTE | pull | shell | shell | shell |
| REMOTE | push | shell | shell | shell |
| HISTORY | get_commit_log | shell | shell | shell |
| HISTORY | get_commit_detail | shell | shell | shell |
| HISTORY | get_commit_files | shell | shell | shell |
| HISTORY | get_commit_file_diff | shell | shell | shell |
| HISTORY | get_ahead_behind | shell | shell | shell |
| MISC | cherry_pick | shell | shell | shell |
| MISC | revert | shell | shell | shell |
| MISC | create_tag | shell | shell | shell |

### 设计方案

**核心抽象：`GitTransport` trait**

```rust
// git/transport.rs
#[async_trait]
pub trait GitTransport: Send + Sync {
    async fn exec(&self, cwd: &str, cmd: &str) -> Result<String>;
    fn supports_git2(&self) -> bool { false }
    fn local_repo(&self, cwd: &str) -> Option<git2::Repository> { None }
}
```

三个实现：

| 实现 | 行为 |
|---|---|
| `LocalTransport` | `std::process::Command::new("git")` + `CREATE_NO_WINDOW`，同步包装为 async |
| `WslTransport { distro }` | `wsl.exe -d {distro} bash -c {cmd}`，同步包装为 async |
| `RemoteTransport { host, port, username, auth }` | `russh` SSH connect + exec，原生 async |

**统一分拆 `git/local.rs`（1994行 → 6个模块）：**

| 新模块 | 职责 | 来源函数 |
|---|---|---|
| `git/status.rs` | 仓库信息、变更文件、diff stats | `get_git_info`, `get_changed_files`, `get_changed_files_diff_stats`, `is_git_repo` |
| `git/staging.rs` | 暂存/取消暂存/丢弃 | `stage_files`, `unstage_files`, `stage_all`, `unstage_all`, `discard_file`, `discard_all` |
| `git/branching.rs` | 分支管理 | `checkout_branch`, `create_branch`, `rename_branch`, `delete_branch`, `create_and_switch_branch`, `checkout_detached`, `default_branch` |
| `git/worktree_ops.rs` | Worktree CRUD | `create_worktree`, `remove_worktree`, `rename_worktree`, `get_worktrees`, `is_worktree_dirty` |
| `git/history.rs` | 提交日志、cherry-pick、revert、tag | `get_commit_log`, `get_commit_detail`, `get_commit_files`, `get_commit_file_diff`, `cherry_pick`, `revert`, `create_tag` |
| `git/parsers.rs` | 共享解析逻辑 | `parse_unified_diff`, `collapse_diff_context`, `parse_commit_log`, `parse_git_info_output`, `build_file_tree_from_find` |

**Command 层合并（三合一）：**

```rust
// commands/git_unified.rs — 替代 git.rs + wsl_git.rs + remote_git.rs
pub enum GitTransportKind {
    Local,
    Wsl { distro: String },
    Remote { host: String, port: u16, username: String, auth: AuthMethod },
}

#[tauri::command]
pub async fn git_checkout_branch(
    project_id: String,
    branch: String,
    transport: GitTransportKind,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let t = build_transport(&transport, &state).await?;
    let cwd = resolve_cwd(&project_id, &transport, &state)?;
    git::operations::checkout_branch(&*t, &cwd, &branch).await?;
    Ok(())
}
```

### 迁移路径

| 阶段 | 做什么 | 风险 |
|---|---|---|
| 1 | 创建 `git/parsers.rs`，将共享解析函数迁移过去 | 零风险 |
| 2 | 创建 `GitTransport` trait + 三个实现 + 测试 | 零风险 |
| 3 | 创建 `git/operations.rs`，从 shell 命令函数开始（占 85%） | 低风险 |
| 4 | 将 local.rs 的 6 个 git2 函数转换为 shell 或保留 git2 快速路径 | 中风险 |
| 5 | 创建 `commands/git_unified.rs`，前端逐步切换 invoke 名称 | 中风险 |
| 6 | 删除旧文件 | 低风险 |

### 预期收益

- 删除 ~2,500 行重复代码
- 新增 git 功能只需一次实现
- 测试通过 mock transport 即可覆盖三种上下文

---

## 方案二：Terminal 视图合并

### 现状诊断

三个视图组件共享 ~80% 代码。差异点分析：

| 差异 | Local | WSL | Remote |
|---|---|---|---|
| 创建命令 | `create_terminal_session` | `create_wsl_terminal_session` | `create_remote_terminal_session` |
| Resize 命令 | `resize_terminal` | `resize_terminal` | `resize_remote_terminal` |
| Agent 延迟 | 0ms | 500ms | 800ms |
| Agent 去重 | `executedAgentKeys` | 无 | 无 |
| 命令覆盖 | 支持 `agentCommandOverrides` | 不支持 | 不支持 |
| 输出过滤 | 过滤 0x7F(DEL) | 不过滤 | 不过滤 |
| terminal-closed 监听 | 有（task-aware） | 无 | 无 |
| Terminal links | 有 | 无 | 无 |
| Loading 指示器 | 命令式 DOM | React overlay | React overlay |
| ResizeObserver | skip-first + window resize | 标准 | 标准 |
| Cache 类型 | `unlistenOutput` + `unlistenClosed` | 单一 `unlisten` | 单一 `unlisten` |

### 设计方案

**`SessionStrategy` 接口：**

```typescript
// terminal/strategies/types.ts
export interface SessionStrategy {
  readonly cachePrefix: string;
  readonly createCommand: string;
  readonly resizeCommand: string;
  readonly closeCommand: string;
  readonly agentLaunchDelayMs: number;
  readonly trackExecutedAgents: boolean;
  readonly filterDelFromOutput: boolean;
  readonly listenForClose: boolean;
  readonly setupLinks: boolean;
  readonly supportsCommandOverride: boolean;
  readonly errorPrefix: string;
  readonly connectingMessage: string;
  buildCreateParams(ctx: SessionContext): Record<string, unknown>;
}
```

**三个策略实现：**

| Property | `LocalStrategy` | `WslStrategy` | `RemoteStrategy` |
|---|---|---|---|
| `cachePrefix` | `""` | `"wsl:"` | `"remote:"` |
| `createCommand` | `"create_terminal_session"` | `"create_wsl_terminal_session"` | `"create_remote_terminal_session"` |
| `resizeCommand` | `"resize_terminal"` | `"resize_terminal"` | `"resize_remote_terminal"` |
| `closeCommand` | `"close_terminal_session"` | `"close_terminal_session"` | `"close_remote_terminal_session"` |
| `agentLaunchDelayMs` | `0` | `500` | `800` |
| `trackExecutedAgents` | `true` | `false` | `false` |
| `filterDelFromOutput` | `true` | `false` | `false` |
| `listenForClose` | `true` | `false` | `false` |
| `setupLinks` | `true` | `false` | `false` |
| `supportsCommandOverride` | `true` | `false` | `false` |
| `errorPrefix` | `"[Terminal]"` | `"[WSL]"` | `"[SSH]"` |

**统一 Cache 类型：**

```typescript
export interface UnifiedTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  listeners: (() => void)[];  // 替代 unlisten/unlistenOutput/unlistenClosed
  inputController: TerminalInputController | null;
}
```

**`TerminalViewBase` 组件 + 薄适配器：**

```tsx
// TerminalViewBase — 统一的生命周期管理
export function TerminalViewBase({ strategy, cacheKey, buildCreateParams, onSessionReady }) {
  // 统一的 xterm 初始化、ResizeObserver、attach/detach、agent launch
}

// WSLTerminalView — 从 262 行变为 ~30 行
export function WSLTerminalView({ paneId, onSessionReady }) {
  const { activeWslProject } = useWslContext();
  if (!activeWslProject) return null;
  return <TerminalViewBase strategy={wslStrategy} cacheKey={...} buildCreateParams={...} />;
}
```

### 迁移路径

| 阶段 | 做什么 |
|---|---|
| 1 | 统一 Cache 类型为 `UnifiedTerminalCache`（listeners 数组） |
| 2 | 创建 `strategies/types.ts` + 三个策略文件 |
| 3 | 创建 `TerminalViewBase.tsx`，先用 WSL 视图验证 |
| 4 | 迁移 RemoteTerminalView 为适配器 |
| 5 | 迁移 TerminalView（local），保留 task-terminal 特殊逻辑 |
| 6 | 删除三个旧组件 |

### 预期收益

- 删除 ~400 行重复代码
- 新增终端类型只需一个 strategy 文件（~20行）
- Agent launch 行为统一，修复 Remote/WSL 缺少去重的问题

---

## 方案三：`useAppContainer` 拆分

### 现状诊断

757 行，实例化 14 个 hook，组装 4 个 prop bag。Tier 依赖图：

```
TIER 0: useAppConfig, useToast, useLocalProjects, useSessionPersistence, useTerminalTabs, useActiveProject
TIER 1: useWslProjects, useRemoteProjects, useWorktreeState, useWslActions, useRemoteActions, useAgentActions, useRemoteAuthActions, useFileView
TIER 2: useWorktreeActions, useSessionBootstrap
CROSS:  useSyncToStore, useKeyboardShortcuts, useDelayedInit
```

### 设计方案

**拆分为独立组合 hook：**

| 新 hook | 替代 | 依赖 | 独立性 |
|---|---|---|---|
| `useTitleBarProps` | Bag 1 (~120行) | useLocalProjects, useWslProjects, useRemoteProjects, useWorktreeState, useWslActions, useRemoteActions, useActiveProject | 完全独立 |
| `useAppLayoutProps` | Bag 3 (~30行) | useLocalProjects, useWslProjects, useRemoteProjects | 完全独立 |
| `useAppModalsProps` | Bag 4 (~100行) | useLocalProjects, useWslProjects, useRemoteProjects, useWslActions, useRemoteActions, useRemoteAuthActions | 基本独立 |
| `useAppProvidersContext` | Bag 2 (~250行) | 全部 hooks | 需进一步拆分 |

**Bag 2 进一步拆分（per-context）：**

| 子 hook | Context | 独立性 |
|---|---|---|
| `useAppContextValue` | AppProvider | 完全独立 |
| `useProjectActionsContextValue` | ProjectActionsProvider | 完全独立 |
| `useFileActionsContextValue` | FileActionsProvider | 完全独立 |
| `useWslContextValue` | WslProvider | 需要 `useConnectionTransientState` |
| `useRemoteContextValue` | RemoteProvider | 需要 `useConnectionTransientState` |
| `useEditorContextValue` | EditorProvider | 需要 `useAgentClickHandler` |

**两个辅助 hook 解决跨域耦合：**

```typescript
// useConnectionTransientState — 共享的 reset 函数
export function useConnectionTransientState() {
  return {
    resetWslTransient: () => useAppStore.setState({
      activeWslWorktreePath: null, wslActiveWtBranch: "", wslOpenedWt: []
    }),
    resetRemoteTransient: () => useAppStore.setState({
      activeRemoteWorktreePath: null, remoteActiveWtBranch: "", remoteOpenedWt: []
    }),
  };
}

// useAgentClickHandler — 多路分发提取为独立 hook
export function useAgentClickHandler() {
  const tabs = useTerminalTabs();
  const agentActions = useAgentActions(/* ... */);
  const wslActions = useWslActions(/* ... */);
  const remoteActions = useRemoteActions(/* ... */);
  const activeCtx = useActiveProject();
  return useCallback((agentId: string) => {
    // 根据 activeCtx.projectType 分发
  }, [...]);
}
```

### App.tsx 变更

```tsx
// Before
function App() {
  const { titleBarProps, appProvidersProps, appLayoutProps, appModalsProps, toast } = useAppContainer();
  // ...
}

// After
function App() {
  const titleBarProps = useTitleBarProps();
  const layoutProps = useAppLayoutProps();
  const modalsProps = useAppModalsProps();
  const contextValues = useAppProvidersContext();
  const { toast } = useAppBootstrap();
  useKeyboardShortcutsWrapper();
  // ...
}
```

### 迁移路径

| 阶段 | 做什么 |
|---|---|
| 1 | 提取 `useAppLayoutProps`（最简单，零风险） |
| 2 | 提取 `useTitleBarProps`（完全独立） |
| 3 | 提取 `useAppModalsProps` |
| 4 | 提取 `useAppContextValue` + `useProjectActionsContextValue` + `useFileActionsContextValue` |
| 5 | 提取 `useConnectionTransientState` + `useAgentClickHandler` |
| 6 | 提取 `useWslContextValue` + `useRemoteContextValue` + `useEditorContextValue` |
| 7 | 删除 `useAppContainer` |

### 预期收益

- 757 行 → 最大单文件 ~250 行
- 每个区域 hook 独立可测试
- 新增功能只需修改对应区域 hook

---

## 方案四：`appStore` 切片拆分

### 现状诊断

822 行单一 store，9 个领域，12 个 hook 直接调用 `setState()`。关键跨域操作：`handleSelectProjectWithClear` 一次原子写入 16 个字段覆盖 5 个领域。

**Hook 写入所有权矩阵（简化）：**

| Hook | 写入的领域 |
|---|---|
| useLocalProjects | Project, Tab |
| useSessionBootstrap | Project, Git |
| useWorktreeState | Worktree, Tab |
| useWslProjects | Connection(WSL) |
| useWslActions | Connection(WSL), Worktree(WSL), Project, Connection(Remote) |
| useRemoteProjects | Connection(Remote), Auth |
| useRemoteActions | Connection(Remote), Worktree(Remote), Project, Connection(WSL) |
| useAgentActions | Project, Connection(WSL), Connection(Remote) |
| useFileView | FileView |
| useSyncToStore | Connection(WSL+Remote), Worktree |
| useAppContainer | Project + Connection + Worktree + Tab（全部） |

### 设计方案

**使用 Zustand slice 模式拆分为 6 个 slice：**

| Slice | 字段 | 行数估算 | 主要 Writer |
|---|---|---|---|
| `projectSlice` | `projects`, `activeProjectId`, `activeProject`, `isTerminalView` | ~120 | useLocalProjects, useSessionBootstrap |
| `connectionSlice` | `wslEntries`, `activeWslKey`, `activeWslProject`, `remoteEntries`, `activeRemoteKey`, `activeRemoteProject`, `remoteAuthStore`, `pendingAuthEntry` | ~180 | useWslProjects, useRemoteProjects |
| `worktreeSlice` | `worktreeStateMap`, `activeWorktreePath`, `activeWorktreeBranch`, `openedWorktrees`, `worktreeState`, WSL/Remote transient | ~150 | useWorktreeState, useWslActions, useRemoteActions |
| `tabEditorSlice` | `tabs`, `activeTabId`, `editorLayout`, `leftPanelWidth` | ~250 | store actions, useTerminalTabs |
| `fileViewSlice` | `fileTree`, `fileViewLoading`, `activeFilePath` | ~60 | useFileView |
| `gitSlice` | `aheadBehind` | ~20 | setAheadBehind |

```typescript
// store/slices/project.ts
export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: true,
  setProjects: (projects) => set((s) => {
    const active = projects.find(p => p.id === s.activeProjectId) ?? null;
    return { projects, activeProject: active };
  }),
  // ...
});

// store/appStore.ts — 组合
export const useAppStore = create<AppState>()((...a) => ({
  ...createProjectSlice(...a),
  ...createConnectionSlice(...a),
  ...createWorktreeSlice(...a),
  ...createTabEditorSlice(...a),
  ...createFileViewSlice(...a),
  ...createGitSlice(...a),
}));
```

**删除 `useSyncToStore`：** 当 WSL/Remote/Auth 状态从 hook 的 `useState` 迁移到 store 后，bridge hook 不再需要。

### 迁移路径

| 阶段 | 做什么 |
|---|---|
| 1 | 创建 6 个 slice 文件，将现有代码按域搬入（零行为变更） |
| 2 | 逐个 hook 迁移：将 `useState` 替换为 store selector + store action |
| 3 | 删除 `useSyncToStore` |
| 4 | 删除 store 中的 noop action |
| 5 | 将跨域操作移入 `orchestrator.ts` |

### 预期收益

- 822 行 → 6 个 ~60-250 行的 slice
- 删除 `useSyncToStore`（89 行）
- 每个 slice 有明确的 owner

---

## 方案五：SSH 认证整合

### 现状诊断

4 个完全相同的认证代码块，分布在 2 个文件中：

| 位置 | 函数 | 行号 |
|---|---|---|
| `remote.rs` | `create_session()` | 72-95 |
| `remote.rs` | `test_connection()` | 302-325 |
| `remote.rs` | `list_directories()` | 362-385 |
| `utils/command/ssh.rs` | `exec_command()` | 52-71 |

每个块的结构完全相同：

```rust
let auth_result = match auth {
    AuthMethod::Password(password) => {
        session.authenticate_password(username, password).await?
    }
    AuthMethod::KeyFile(key_path) => {
        let key_pair = russh::keys::load_secret_key(key_path, None)?;
        let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
        session.authenticate_publickey(username, key_with_hash).await?
    }
    AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
        let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
        let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
        session.authenticate_publickey(username, key_with_hash).await?
    }
};
if !auth_result.success() {
    return Err(anyhow::anyhow!("SSH authentication failed"));
}
```

### 设计方案

**新建 `utils/command/ssh_auth.rs`：**

```rust
// utils/command/ssh_auth.rs
pub async fn authenticate(
    session: &client::Handle<impl client::Handler>,
    username: &str,
    auth: &AuthMethod,
) -> Result<()> {
    // 唯一的 match 块
}

pub async fn connect_and_authenticate(
    host: &str, port: u16, username: &str, auth: &AuthMethod,
) -> Result<client::Handle<Client>> {
    let config = Arc::new(client::Config::default());
    let session = client::connect(config, (host, port), Client).await?;
    authenticate(&session, username, auth).await?;
    Ok(session)
}
```

**重构调用方：**

```rust
// remote.rs create_session() — 25行 → 1行
let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;

// utils/command/ssh.rs exec_command() — 20行 → 1行
let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;
```

### 迁移路径

| 阶段 | 做什么 |
|---|---|
| 1 | 创建 `ssh_auth.rs` + 测试 |
| 2 | 重构 `remote.rs` 的 3 个函数 |
| 3 | 重构 `utils/command/ssh.rs` 的 `exec_command` |
| 4 | 删除旧的内联认证代码 |

### 预期收益

- 删除 ~80 行重复代码
- 新增认证方式只改一处

---

## 方案六：Theme 安装编排

### 现状诊断

| 文件 | 位置 | Theme 调用数 |
|---|---|---|
| `app.rs` | 31-38 | 2（本地全局） |
| `terminal.rs` | 89, 796-813 | 2（本地项目级） |
| `terminal.rs` | 156-174 | 4（WSL 全局 + 项目级） |
| `remote.rs` | 105, 436-520 | 4（SSH 全局 + 项目级） |
| `commands/config.rs` | 111-146 | 4（sync_agent_theme） |

`opencode_theme.rs`（650行）和 `pi_theme.rs`（775行）有 8 个结构相同的函数。`read_neeko_theme()` 在 `remote.rs:523` 和 `terminal.rs:816` 中重复定义。

### 设计方案

**新建 `theme/` 模块：**

```
theme/
├── mod.rs          # 统一编排层
├── common.rs       # 共享逻辑（map_theme_name, base64_encode, shell_escape, read_neeko_theme）
├── opencode.rs     # OpenCode 特定实现（从 opencode_theme.rs 迁移）
└── pi.rs           # Pi 特定实现（从 pi_theme.rs 迁移）
```

**`theme/mod.rs` — 统一入口：**

```rust
pub enum ThemeContext<'a> {
    Local { project_path: &'a str },
    Wsl { distro: &'a str, project_path: &'a str },
    Remote { channel: &'a mut russh::Channel<russh::client::Msg>, project_path: &'a str },
}

pub fn install_all_global_themes(ctx: &ThemeContext) -> Result<()> { /* 根据 ctx 分发 */ }
pub fn write_project_theme_config(ctx: &ThemeContext, project_path: &str, theme: &str) -> Result<()> { /* 根据 ctx 分发 */ }
```

**简化调用方：**

```rust
// app.rs — 2行替代原来的 2 行（但语义更清晰）
theme::install_all_global_themes(&ThemeContext::Local { project_path: "" })?;

// terminal.rs create_session() — 1行替代 2 行
theme::write_project_theme_config(&ThemeContext::Local { project_path: cwd }, cwd, &theme)?;

// remote.rs — 2行替代 80 行
theme::install_all_global_themes(&ThemeContext::Remote { channel: &mut ch, project_path })?;
theme::write_project_theme_config(&ThemeContext::Remote { channel: &mut ch, project_path }, project_path, &theme)?;
```

### 迁移路径

| 阶段 | 做什么 |
|---|---|
| 1 | 创建 `theme/common.rs`，提取共享函数 |
| 2 | 迁移 `opencode_theme.rs` → `theme/opencode.rs`，`pi_theme.rs` → `theme/pi.rs` |
| 3 | 创建 `theme/mod.rs` 编排层 |
| 4 | 简化 app.rs、terminal.rs、remote.rs、commands/config.rs |

### 预期收益

- Theme 行为集中在 `theme/` 目录
- `read_neeko_theme()` 不再重复
- 调用方从 16 个散布调用 → 4-5 个统一入口

---

## 方案七：Prop 传递塌缩

### 现状诊断

`EditorGroupPane` 接收 25+ props。分析发现：

- **2 个死代码**：`tabKey`（从未解构）、`onToggleHiddenAgent`（从未使用）
- **8 个可从 Context 直接获取**：`agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onToggleHiddenAgent`, `onAgentClick`, `config`, `showToast`
- **8+ 个可从 Store 直接派生**：`tabs`, `activeTabId`, `pinnedTabId`, `isFocused`, `onActivateTab`, `onCloseTab`, `onSplitRight`, `onMoveToRight`, `onMoveToLeft`, `onFocusGroup`
- **仅 3-4 个必须保留**：`groupId`, `layoutId`, `contextMenuExtras`, `remoteProject`

### 设计方案

**四阶段清理：**

**Phase 1（零风险）— 删除死代码 + Context 直读：**

```tsx
// EditorGroupPane.tsx — 从 25+ props → 16 props
const { agents, compactMode, showAgentBar, hiddenAgentIds, onAgentClick } = useEditorContext();
const { config, showToast } = useAppContext();
```

删除：`agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onToggleHiddenAgent`, `onAgentClick`, `config`, `showToast`, `tabKey`（死代码）

**Phase 2（低风险）— Store 直读：**

```tsx
const layout = useEditorGroupLayout(tabKey);
const activeTabId = groupId === "left" ? layout.leftActiveTabId : /* ... */;
const isFocused = layout.activeGroupId === groupId;
const onActivateTab = (tabId: string) => useAppStore.getState().activateTab(tabKey, tabId);
```

删除：`tabs`, `activeTabId`, `pinnedTabId`, `isFocused`, `onActivateTab`, `onCloseTab`, `onSplitRight`, `onMoveToRight`, `onMoveToLeft`, `onFocusGroup`

**Phase 3（中等风险）— 消除 Context overlay：**

让子组件（TerminalView、DiffView）直接接收 `tabKey` + `groupId`，自行从 store 读取，消除对 `onAddTerminalTab` 等回调 prop 的需求。

**Phase 4 — wslProject 移入 Context：**

`wslProject` 从 `useWslContext().activeWslProject` 直接读取。

**最终接口（5 props）：**

```typescript
interface EditorGroupPaneProps {
  groupId: "left" | "right" | "pinned";
  layoutId: string;
  tabKey: string;
  contextMenuExtras?: (tabId: string) => ContextMenuItem[];
  remoteProject?: RemotePaneProject | null;
}
```

### 迁移路径

| 阶段 | 做什么 | 影响文件 |
|---|---|---|
| Phase 1 | 删除死代码，改为 context 直读 | EditorGroupPane.tsx, EditorGroupLayout.tsx |
| Phase 2 | Store 直读 | EditorGroupPane.tsx |
| Phase 3 | 消除 overlay | EditorGroupPane.tsx, TerminalView.tsx, DiffView.tsx |
| Phase 4 | wslProject → context | EditorGroupPane.tsx, MainContent.tsx |

### 预期收益

- Props 从 25+ → 5（80% 缩减）
- `sharedPaneProps` bundle 删除
- 组件变得可测试

---

## 附录：代码量统计

### 后端 Rust（src-tauri/src/）

| 模块类别 | 文件数 | 行数 |
|---|---|---|
| 顶层模块 | 17 | ~4,733 |
| commands/ | 13+ | ~5,463 |
| git/ | 5 | ~3,769 |
| models/ | 6 | ~420 |
| skill/ | 12 | ~4,100 |
| utils/ | 5 | ~250 |
| **合计** | **63** | **~19,675** |

### 前端 TypeScript（src/）

| 模块类别 | 文件数 | 行数 |
|---|---|---|
| hooks/ | 30 | ~5,998 |
| store/ | 6 | ~1,665 |
| components/ | ~25 | ~5,000+ |
| contexts/ | 7 | ~500+ |
| **合计** | **~68** | **~13,000+** |

### 测试覆盖

| 区域 | 有测试的模块 | 无测试的关键模块 |
|---|---|---|
| 后端 | agent.rs (15), git_worker.rs (9), git/local.rs (12), skill/* (58) | terminal.rs (822行), remote.rs (535行), watcher.rs (416行), storage.rs (179行) |
| 前端 | useToast, useSplitLayout, useActiveProject, fileIcons, distros, agents | useAppContainer (757行), useBrowserPanel (606行), appStore (822行) |
