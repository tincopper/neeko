# Search — Technical Design

## 1. Overview

新增后端 `search/` 域（Domain-Driven）与前端 `features/search/` 域（Feature-Based），以侧边栏 Dock 面板为统一搜索入口。后端按 `ExecTarget` 分发 local（ripgrep 库）与 WSL/SSH（远程 grep），前端多模式容器聚合「内容」与「文件名」两种搜索。

## 2. Backend Design

### 2.1 Module layout

```
src-tauri/src/search/
├── mod.rs            # 仅 mod + pub use（红线 #9 极薄）
├── commands.rs       # 薄层：参数校验 + 调度（红线 #6）
├── services.rs       # ExecTarget 分发 + 取消/超时编排
├── matcher.rs        # Pattern 编译（纯函数，可单测）
├── engine_local.rs   # ripgrep 库封装（grep-searcher + grep-regex + ignore）
├── engine_remote.rs  # 远程 grep 命令构造 + 输出解析
└── types.rs          # DTO 与常量
```

### 2.2 Types (types.rs)

```rust
#[derive(Serialize, Deserialize, Clone)]
pub enum SearchMode { Content, FileName }

#[derive(Serialize, Deserialize, Clone)]
pub struct SearchOptions {
    pub mode: SearchMode,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub file_path: String,   // 项目相对路径
    pub line: u32,
    pub column: u32,
    pub line_text: String,   // 命中行文本（限长，防大文本）
}

#[derive(Serialize)]
pub struct SearchPage {
    pub items: Vec<SearchMatch>,
    pub total: u32,
    pub has_more: bool,
    pub truncated: bool,     // 超时/上限截断
    pub degraded: bool,      // 远程 regex 降级为字面
}
```

常量：
- `SEARCH_PAGE_LIMIT_DEFAULT = 100`，`SEARCH_PAGE_LIMIT_MAX = 500`
- `SEARCH_TOTAL_CAP = 50_000`（本地收集上限）
- `SEARCH_REMOTE_TIMEOUT = Duration::from_secs(15)`
- `SEARCH_LINE_TEXT_CAP = 500`（单行文本截断）

### 2.3 Commands (commands.rs)

```rust
#[tauri::command]
pub async fn search_in_files(
    query: String,
    project_id: String,
    options: SearchOptions,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AppStateWrapper>,
) -> Result<SearchPage, AppError>
```

薄层职责：
1. 校验 `query` 非空、`limit` 钳制到 `[1, MAX]`。
2. 经 `ProjectManager` 解析 project root + `ProjectEnvironment`（含 worktree 路径）。
3. `root.canonicalize()` 后构造 `ExecTarget`（`ProjectEnvironment::to_exec_target()`）。
4. 调用 `services::search_in_files(...)`，错误映射 `AppError::from`。

### 2.4 Services (services.rs)

```rust
pub async fn search_in_files(
    target: &ExecTarget,
    root: &str,
    query: &str,
    opts: &SearchOptions,
    offset: u32,
    limit: u32,
) -> Result<SearchPage, AppError> {
    match target {
        ExecTarget::Local => search_local(root, query, opts, offset, limit).await,
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } =>
            search_remote(target, root, query, opts, offset, limit).await,
    }
}
```

取消模型：
- `commands.rs` 接收 `request_id` 后，在 `AppStateWrapper` 的取消注册表（`Mutex<HashMap<String, CancellationToken>>`）登记；新请求先 `cancel()` 同 `request_id` 旧 token。
- 前端每次请求携带递增 `request_id`；新请求到来时后端取消旧 token（服务端兜底），前端另有 AbortController。

### 2.5 engine_local.rs

- 依赖：`grep-searcher` + `grep-regex` + `ignore`（WalkBuilder 尊重 .gitignore）。
- `build_matcher(query, opts) -> Result<grep_regex::RegexMatcher>`：正则/字面/大小写/全词（`\b`）编译；非法正则返回 `AppError::InvalidInput`。
- WalkBuilder：`hidden(false)` 默认扫隐藏但 `standard_filters(true)`；合并 exclude glob。
- `Searcher::new().search_reader(...)` 并行（`grep-searcher` 自带多线程）；每行回调收集 `SearchMatch`，行文本截断 `SEARCH_LINE_TEXT_CAP`。
- 二进制文件：`Searcher` 默认跳过二进制（`is_binary`）。
- 整体包裹 `tokio::task::spawn_blocking`（红线 #3）。
- 收集全部匹配至 `SEARCH_TOTAL_CAP`，`sort_by(path, line)` 后按 `[offset, offset+limit)` 切片。

### 2.6 engine_remote.rs

- 命令：`grep -r -n --include GLOB ... pattern root`，参数数组传给统一 Executor（`create_executor(target)`，`spawn_with` 或等价 async API）。**禁止 shell 字符串拼接**（红线 #8）。
- include/exclude glob 映射为 `--include` / `--exclude` 参数。
- 输出解析：`file:line:col:text` 逐行；`String::from_utf8_lossy`；行文本截断。
- `tokio::time::timeout(SEARCH_REMOTE_TIMEOUT, child.wait_with_output())`，超时标记 `truncated = true` 并返回已收集部分。
- `regex: true` → 远程降级为字面搜索，`degraded = true`。

### 2.7 Registration

- `src-tauri/src/lib.rs`：`pub mod search;` + `neeko_invoke_handler!` 追加 `$crate::search::commands::search_in_files`。
- `Cargo.toml`：追加 `grep-searcher = "0.1"`、`grep-regex = "0.1"`。

## 3. Frontend Design

### 3.1 Feature layout

```
src/features/search/
├── index.ts              # 门面：SearchPanel + useSearch
├── api/searchApi.ts      # invoke + AbortController
├── components/
│   ├── SearchPanel.tsx       # 多模式容器
│   ├── SearchModeTabs.tsx    # Content / File 切换
│   ├── SearchInput.tsx
│   ├── SearchOptionsBar.tsx  # 大小写/全词/正则/include/exclude
│   ├── SearchResultsTree.tsx # 文件分组 + 虚拟滚动
│   └── SearchStatusBar.tsx   # 总数/加载/截断/降级提示/加载更多
├── hooks/useSearch.ts
└── store/searchStore.ts  # zustand（约定式公开面）
```

### 3.2 store/searchStore.ts

```ts
interface SearchStore {
  open: boolean;
  mode: 'content' | 'file';
  query: string;
  options: { caseSensitive; wholeWord; regex; include; exclude };
  groupedResults: GroupedResult[];
  total: number; hasMore: boolean; truncated: boolean; degraded: boolean;
  loading: boolean; error: string | null; offset: number; requestId: number;
  openPanel(); closePanel();
  setMode(m); setQuery(q); setOptions(o); toggleOpen();
  runSearch(); loadMore(); reset();
}
```

### 3.3 Data flow

1. `Ctrl+Shift+F`（或 Command Palette）→ `openPanel()` 聚焦输入框。
2. Content 模式：`useSearch` debounce（300ms）→ `searchApi.searchInFiles`（携带 `requestId`，AbortController 取消旧请求）。
3. 后端 `search_in_files` → `SearchPage` → store 分组更新。
4. 命中行点击 → `openProjectFile({ projectId, filePath, line, column })`（复用 `features/quick-open/openFile.ts`）。
5. File 模式：复用 Quick Open `fuzzy.ts` + `fileIndex.ts` 本地过滤，不调用后端。

### 3.4 Dock & shortcut registration

- `src/shared/dock/panelMeta.ts`：`search: { id: 'search', defaultZone: 'left', defaultOrder: 1 }`；`DockPanelId` 联合类型追加 `'search'`。
- `src/app/dock/registry.ts`：lucide `Search` icon，lazy `SearchPanel`。
- `src/app/dock/DockPanelWrappers.tsx`：`SearchPanelWrapper` 注入 activeProject。
- `src/shared/utils/shortcutRegistry.ts`：
  - `SHORTCUT_ACTIONS` 追加 `{ id: 'searchInFiles', label: 'Search in Files', defaultBinding: 'Ctrl+Shift+F', category: 'workspace' }`
  - `IDEA_SHORTCUT_PRESET` 追加 `searchInFiles: 'Ctrl+Shift+F'`
- `src/shared/hooks/useKeyboardShortcuts.ts`：`case 'searchInFiles'` → `openPanel()`。
- `src/features/action-menu/actionRegistry.ts`：新增「Search in Files…」action。

### 3.5 Virtual scroll & session restore

- `SearchResultsTree` 复用 `features/git/components/gitlog/virtualScroll.ts` 的虚拟滚动模式。
- 会话恢复：query/filters/开合经 `sessions.json` 持久化（`session/commands.rs` 扩展或复用 settings store）；项目切换时保留 query 并显示「已切换到 X 项目」状态提示，自动重搜。

## 4. Event / IPC Boundaries

- 不使用双向 Event 流（结果走命令返回 + 分页），避免 IPC 大文本超限（红线 #4）。
- 无新增 Tauri Event 名，无 event 硬编码风险。

## 5. Testing Strategy

| 层级 | 文件 | 覆盖 |
|---|---|---|
| matcher.rs | `#[cfg(test)]` | 字面/正则/大小写/全词/非法正则/glob |
| engine_local.rs | `#[test]` + tempfile | 命中行列、二进制跳过、多字节、sort+分页、上限 |
| services.rs | `#[test]` | 分发、超时 truncated、取消 token |
| searchStore/useSearch | Vitest renderHook | debounce、AbortController、loadMore、模式切换、错误态 |
| 组件 | Testing Library | 命中跳转、虚拟滚动、截断/降级提示 |

## 6. Trade-offs & Rollback

- **ripgrep 库 vs 手写扫描**：选 ripgrep 库 —— 正确性/性能/跨平台一致，代价为 +2~3 crate。回滚路径：`engine_local` 内部替换为 `ignore+regex` 手写实现，接口不变。
- **远程 grep 一致性降级**：正则跨环境不承诺一致（MVP 降级字面），避免引入 PCRE 依赖与平台差异。回滚/扩展：后续按需接入 PCRE2。
- **不引入持久化索引**：实时扫描满足需求（YAGNI）；若大仓性能不足，后续可加缓存索引，`services` 接口保持不变。
