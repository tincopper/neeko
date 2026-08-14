# Git 历史展示域重构 — 技术设计

## 1. 边界与职责

| 层 | 模块 | 职责 |
|---|---|---|
| Rust 域逻辑 | `common/git/` | refs 分类纯函数、`CommitEntry.refs` 归一化（仅保留可展示类别）、log 参数固定为 `HEAD`、stash list/files 查询 |
| Rust 命令 | `git/commands.rs` | `get_commit_log` 透传 operations；新增 `get_stash_list` / `get_stash_files`；保持极薄 |
| 前端 API | `features/git/api/gitApi.ts`、`features/project/hooks/.../commandFactory.ts` | `getStashList` / `getStashFiles` 透传 |
| 前端逻辑 | `useGitLog.ts`、新 `useStashList.ts` | 历史跟随 checkout 分支；stash 列表加载 + 展开详情 |
| 前端 UI | `CommitListItem.tsx`、`commitListUtils.ts`、新 `StashPanel.tsx` | refs 标签分类渲染；Git Control 面板新增 Stash tab |
| 剪贴板 | 共享 hook（`shared/hooks/`） | 统一复制：插件 `writeText` → 失败兜底 toast |
| 权限 | `src-tauri/capabilities/default.json` | 补 `clipboard-manager:allow-write-text` |

## 2. 契约（类型签名）

### 2.1 refs 分类（`common/git/` 纯函数，放 `parsers.rs` 或独立 `refs.rs`）

输入 `%D` decorate 字符串，输出有序标签列表，丢弃 tool 类：

```rust
pub enum RefKind { Branch, Remote, Tag, Stash }

pub struct ParsedRef { pub kind: RefKind, pub name: String } // name 为去掉前缀的短名

/// 解析并过滤：只保留 branch/remote/tag/stash，丢弃其它（tool 类）。
pub fn parse_decorate_refs(decorate: &str) -> Vec<ParsedRef>;
```

分类规则（前缀判定，不硬编码工具名）：
- `HEAD -> refs/heads/…` → Branch（name 取分支短名，如 `main`）；`HEAD` 单独（detached）→ Branch（name = `HEAD`）
- `refs/heads/…` → Branch
- `refs/remotes/…` → Remote
- `refs/tags/…` / `tag: …` → Tag
- `refs/stash` → Stash
- 其它（如 `refs/synara/…`、`refs/aider/…`、`refs/bisect/…`）→ 丢弃

### 2.2 `CommitEntry` 调整（Rust `common/git/types`）

```rust
pub struct CommitEntry {
    // …既有字段…
    pub refs: String,                    // 改为：仅含可展示类别的过滤后 decorate 子串
    pub refs_list: Vec<ParsedRef>,       // 新增：结构化分类（前端可直接用）
}
```

`parse_commit_log_output` 中：`refs` 写为过滤后子串（如 `main, origin/main, v1.0.4`），`refs_list` 填结构化结果。`refs` 为空串时前端 `formatRefs` 天然返回 null。

### 2.3 `get_commit_log` 参数（Rust `operations.rs` / `local.rs`）

```rust
// 移除 "--all"，固定 "--decorate=full" + 显式 "HEAD"
// git log <format> --decorate=full --topo-order HEAD
```

显式传 `HEAD` rev 参数：语义明确（展示当前 checkout 分支），防止未来被改回 `--all`。命令签名不变（`count`/`skip`）。

### 2.4 前端契约

```ts
// features/git/types.ts（CommitEntry 增字段）
export interface ParsedRef { kind: 'branch' | 'remote' | 'tag' | 'stash'; name: string }
export interface CommitEntry {
  …既有…
  refs: string;             // 已过滤的 decorate 子串（前端格式兼容）
  refs_list?: ParsedRef[];  // 新增
}
```

`gitApi.ts` / `commandFactory.ts` / `project.ts` 的 `getCommitLog(count, skip)` 签名不变。

### 2.5 Stash 查询与操作（新增）

```rust
// common/git/types.rs（或 git/types.rs）
pub struct StashEntry {
    pub selector: String,   // "stash@{0}"
    pub hash: String,       // full hash
    pub message: String,    // "WIP on main: 9f3c1a2 feat: xyz"
    pub branch: String,     // 从 %gs 前缀解析（"WIP on <branch>" / "On <branch>"）
    pub timestamp: String,  // 作者时间 ISO（%aI）
}

pub struct StashActionResult {
    pub success: bool,
    pub message: String,    // 成功/冲突摘要
}

pub async fn get_stash_list(transport, work_dir) -> Result<Vec<StashEntry>>
pub async fn get_stash_files(transport, work_dir, selector) -> Result<Vec<CommitFileChange>>
pub async fn get_stash_file_diff(transport, work_dir, selector, file_path) -> Result<Vec<DiffHunk>>
pub async fn stash_apply(transport, work_dir, selector) -> Result<StashActionResult>
pub async fn stash_pop(transport, work_dir, selector) -> Result<StashActionResult>
```

实现：
- 列表：`git stash list --format=%gd%x00%gs%x00%H%x00%aI%x00`（每条记录以 NUL 结尾），按 NUL 切分后每 4 字段一组解析，消息内换行不破坏记录边界；`branch` 从 `%gs` 前缀提取（`WIP on <b>:` / `On <b>:`），失败回退空串
- 文件变更：`git stash show --numstat <selector>` + `git stash show --name-status <selector>`，解析复用 `get_commit_files` 的 numstat/status 合并模式（抽公共函数 `parse_numstat_with_status`）
- 单文件 diff：`git stash show -p <selector> -- <file_path>`，解析复用 `parse_unified_diff`（与 commit 单文件 diff 同一解析器）
- apply：`git stash apply <selector>`；pop：`git stash pop <selector>`。成功 → `StashActionResult { success: true }`；冲突/失败 → `success: false` + 摘要（pop 冲突时 git 保留 stash 条目，列表不刷新）
- 空 stash：列表命令输出为空 → `Vec::new()`

命令注册（`git/commands.rs` + `lib.rs` `neeko_invoke_handler!`）：

```rust
#[tauri::command]
pub async fn get_stash_list(project_id: String, state: State<'_, AppStateWrapper>) -> Result<Vec<StashEntry>, AppError>;
#[tauri::command]
pub async fn get_stash_files(project_id: String, selector: String, state: State<'_, AppStateWrapper>) -> Result<Vec<CommitFileChange>, AppError>;
#[tauri::command]
pub async fn get_stash_file_diff(project_id: String, selector: String, file_path: String, state: State<'_, AppStateWrapper>) -> Result<Vec<DiffHunk>, AppError>;
#[tauri::command]
pub async fn stash_apply(project_id: String, selector: String, state: State<'_, AppStateWrapper>) -> Result<StashActionResult, AppError>;
#[tauri::command]
pub async fn stash_pop(project_id: String, selector: String, state: State<'_, AppStateWrapper>) -> Result<StashActionResult, AppError>;
```

前端：
```ts
// shared/types/project.ts ProjectCommands
getStashList(): Promise<StashEntry[]>;
getStashFiles(selector: string): Promise<CommitFileChange[]>;
getStashFileDiff(selector: string, filePath: string): Promise<DiffHunk[]>;
stashApply(selector: string): Promise<StashActionResult>;
stashPop(selector: string): Promise<StashActionResult>;
```

## 3. 数据流

```
BranchSwitcherPanel checkout(branch)
   └─ commands.checkoutBranch → onRefreshGit
        ├─ baseRefreshGit()：更新 git_info（current_branch）
        └─ refresh() → useGitLog 清空 + probeAndLoad
             └─ commands.getCommitLog(count, skip)
                  └─ invoke('get_commit_log')
                       └─ operations::get_commit_log → git log … HEAD
                            └─ parse_commit_log_output
                                 └─ CommitEntry { refs(过滤), refs_list }
   └─ 渲染：CommitListItem 用 refs_list 渲染分类标签
```

关键点：**展示范围绑定 HEAD**，checkout 切换后 `git_info.current_branch` 与 log 都跟随新分支，无需新增任何切换状态。worktree 场景下 HEAD 语义同样成立（每个 worktree 有独立 HEAD）。

Stash 数据流（独立于 commit log，面板挂载时加载——Stash tab 标题徽章需要 stash 数量）：
```
面板挂载（供 tab 徽章计数）
   └─ useStashList → commands.getStashList()
        └─ invoke('get_stash_list') → operations::get_stash_list
   └─ 点击某条 stash@{N}
        └─ commands.getStashFiles(selector) → invoke('get_stash_files')
             └─ operations::get_stash_files → stash show --numstat/--name-status
   └─ 展开区渲染文件变更（path/status/additions/deletions）
   └─ 点击某文件（内容查看）
        └─ onOpenStashDiff(selector, filePath) → useOpenStashDiff hook（git feature 域）
             └─ addTab + activateTab 打开 diff tab（diffSource 为 stash 变体）
             └─ tab 内 DiffView 渲染（复用 history 打开 diff 文件的机制）
   └─ 行 hover Apply / Pop
        └─ commands.stashApply(selector) / stashPop(selector)
             └─ invoke('stash_apply' / 'stash_pop') → operations::stash_apply / stash_pop
             └─ 成功 → toast + 刷新 stash 列表 + 触发 Git 面板刷新（工作区已变）
             └─ Pop 成功 → 该条移除 + 徽章计数同步；冲突 → 错误 toast，列表不刷新
```

## 4. 前端 UI 设计

### 4.1 Git Control 面板 tab 结构（Stash 为独立 tab）

`GitControlTab` 由 `'changes' | 'history'` 扩展为 `'changes' | 'history' | 'stash'`（`GitControlPanel.tsx:14`）。tab 栏顺序 **[Changes] [History] [Stash]**（Stash 位于 History 右侧）：

```
┌──────────────────────────────────────────────────────────────┐
│  Changes   History   Stash(2)                                 │  ← tab 栏
├──────────────────────────────────────────────────────────────┤
│  activeTab === 'history' → GitLogPanel（当前分支提交历史）     │
│  activeTab === 'stash'    → StashPanel（git stash list + 展开）│
│  activeTab === 'changes'  → GitCommitPanel（分支切换在此）     │
└──────────────────────────────────────────────────────────────┘
```

- 沿用现有「面板保持 mounted + `hidden` 类切换」模式（`GitControlPanel.tsx:137-175`），Stash 展开状态跨 tab 保留
- Stash tab 标题带数量徽章（复用 Changes 的 count 样式），数量为 stash list 长度
- `StashPanel` 组件：`git stash list` 内容（`stash@{N}` 选择器 + 摘要 + 分支 + 时间），点击展开文件变更列表；点击文件打开 diff tab（复用 history 打开 diff 文件的机制，diffSource 为 stash 变体，标题 `stash@{n}: <message>`）；行 hover 显示 Apply / Pop 按钮（Apply 绿、Pop 危险色），操作中 loading 禁用；无 stash 时空态「No stashes」
- `useStashList` 扩展：`applyStash(selector)` / `popStash(selector)`（`actionSelector` + `actionLoading` 防重复），成功后刷新列表 + 触发 Git 面板刷新；单文件 diff 按需加载（复用 `requestSeq` 请求守卫防过期响应）
- Wrapper（`GitControlPanelWrapper`）新增 `useStashList` 加载 stash，`tab` state 类型自动跟随扩展；键盘 J/K 门控仍只在 `history` 生效

### 4.2 不新增历史范围切换

不新增任何范围切换控件。历史 = 当前 checkout 分支（Changes 面板切换）。GitLogPanel 工具栏保持现状。

### 4.3 refs 标签分类渲染

`commitListUtils.formatRefs` 保留为兼容回退（`refs_list` 缺失时用 `refs` 子串）；有 `refs_list` 时按 kind 上色：

| kind | 样式（对齐现有 token） |
|---|---|
| branch | `bg-accent-blue/15 text-accent-blue` |
| remote | `bg-accent-green/15 text-accent-green` |
| tag | `bg-accent-yellow/15 text-accent-yellow` |
| stash | `bg-accent-purple/15 text-accent-purple` |

标签显示第一个 ref（primary），`+N` 汇总剩余（复用现有 `RefPills` 结构）。`tool` 类由后端已过滤，前端无需特判。

## 5. 剪贴板统一修复

### 5.1 新共享 hook `useCopyToClipboard`（`shared/hooks/useCopyToClipboard.ts`）

```ts
/** 优先 Tauri 插件 writeText，失败回退 navigator.clipboard，仍失败则 toast 报错。 */
export function useCopyToClipboard(): (text: string, label?: string) => Promise<boolean>;
```

实现要点：
- 注入 `showToast`（现有 toast 体系）
- `writeText`（插件）失败 → 尝试 `navigator.clipboard.writeText` → 再失败 toast 错误
- 覆盖调用点：`CommitListItem`（核心）、`BranchSwitcherPanel`、`useFilePanelState`、`PromptListSection`、`DockPanelWrappers`、`ConversationViewer`、`NotificationDetail`（保留其既有反馈，改为复用 hook）
- 各调用点补 `await` / `.catch(() => {})`，杜绝 unhandled rejection

### 5.2 capabilities

`src-tauri/capabilities/default.json` permissions 追加：
```json
"clipboard-manager:allow-write-text"
```

## 6. 兼容性与回滚

- **向后兼容**：命令签名不变；`CommitEntry` 只增字段（`refs_list`），`refs` 语义变为「已过滤 decorate」——前端 `formatRefs` 对空串自然降级。
- **行为变更影响面**：仅 Git 历史面板展示范围（`--all` → `HEAD`）。`CommitDialog` 用 `getCommitLog(projectId, 1)` 拿最近提交，HEAD 语义等价覆盖。
- **回滚**：`operations.rs:500` / `local.rs:1047` 恢复 `--all` 即还原；`refs_list` 为附加字段无破坏性。
- **Capabilities 变更**：加 `clipboard-manager:allow-write-text` 属权限收紧方向内的补充，仅允许写剪贴板文本，风险可控。

## 7. 测试策略

### Rust（`#[cfg(test)]` / `src-tauri/tests/unit`）
- `parse_decorate_refs`：branch/remote/tag/stash/HEAD 用例；`refs/synara/checkpoints` 被丢弃；空 decorate。
- `parse_stash_list`：`git stash list --format` 输出解析（selector/hash/message/branch/timestamp）；空输出。
- `get_stash_file_diff` 解析：`git stash show -p` 输出走 `parse_unified_diff`（hunk/add/del/ctx）。
- `stash_apply` / `stash_pop`：成功返回 `StashActionResult`；冲突场景（工作区有冲突文件）返回 `success: false` 且 pop 后 stash 条目保留。
- 集成：临时仓库（tempfile）建分支 + 独立 `refs/synara/checkpoints`（孤立提交），验证 `get_commit_log`（HEAD）不包含 synara 提交；decorate 含 synara 的提交其 `refs`/`refs_list` 不含 tool 项。建 stash 验证 `get_stash_list` / `get_stash_files` / `get_stash_file_diff` / `stash_apply` / `stash_pop`。

### 前端（Vitest）
- `commitListUtils`：`refs_list` 分类染色，tool refs 不出现（数据层已过滤的回归保护）。
- `StashPanel` / `useStashList`：列表加载、点击展开文件变更、点击文件触发 `onOpenStashDiff`（打开 diff tab）、空态。
- `useStashList` apply/pop：调用 `stashApply`/`stashPop`、loading 防重复、成功刷新列表、pop 后条目移除、冲突错误路径。
- `useCopyToClipboard`：插件失败回退路径、最终失败 toast。
- `CommitListItem`：复制调用走 hook、refs 标签渲染。
- 既有 `useGitLog` / checkout 刷新测试不回归。

## 8. 交付物

- 源码修改（Rust + TS）
- `.trellis/tasks/08-14-git-history-log-scope/prototypes/history-scope-prototype.html`（交互式原型：历史范围 + refs 分类 + Stash tab）
- `.trellis/tasks/08-14-git-history-log-scope/prototypes/stash-panel-v2.html`（交互式原型：Stash 内容查看 + Apply/Pop）
- 测试 + `pnpm lint` / `pnpm type-check` / `pnpm test:run` / `cargo test`
- 新命令 `get_stash_list` / `get_stash_files` / `get_stash_file_diff` / `stash_apply` / `stash_pop` 注册进 `neeko_invoke_handler!`
