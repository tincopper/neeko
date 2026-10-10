# 研究：Neeko 当前 watcher 架构事实（代码级）

> 目的：为「忽略子树零监听」的改造提供**可直接引用的现状事实**。
> 所有结论均来自本仓库代码，标注文件路径。

## 1. 平台策略：谁在剪枝，谁在过滤

| 平台 | 决策点 | 行为 |
| --- | --- | --- |
| Linux | `src/platform/watch_strategy/linux.rs` → `watch_selectively() = true` | `Selective`：逐可见目录 `NonRecursive` 注册，ignored 子树**在注册层剪枝** |
| macOS | `src/platform/watch_strategy/macos.rs` → `watch_selectively() = false`（注释："FSEvents 按前缀送达，需整树注册后过滤"） | `Recursive`：`watcher.watch(root, Recursive)` **整树注册** |
| Windows | `src/platform/watch_strategy/windows.rs` → `false` | 同 macOS |

消费点：`src/common/file/watcher/registration/strategy.rs::WatchStrategy::for_platform()`。

- `register_root()`：
  - `Recursive` 分支 → `watcher.watch(root, RecursiveMode::Recursive)`（**无任何剪枝**）；
  - `Selective` 分支 → `register_selective()`。
- `register_selective()` → `compute_watch_dirs(root, filter, MAX_WATCH_DIRS)`：
  - 沿可见树遍历，`should_ignore_own()` 命中即**不注册**（真剪枝）；
  - 超 `MAX_WATCH_DIRS = 5000` 或 `MAX_WATCH_FAILURES = 8` → `degrade_recursive()`（**注册层退化为整树广播**）。
- `degrade_recursive()`：`unwatch` 全部已注册目录，再 `watch(root, Recursive)`。

**结论：Linux 已经实现了"ignored 不监听"；macOS/Windows 靠回调过滤。**

## 2. 事件分类：内容事件过滤了，结构事件没有

`src/common/file/watcher/manager/classify.rs`：

```rust
// 内容/普通事件：gitignore 过滤（should_ignore，含祖先上行）
pub(super) fn relevant_event_paths(paths, filter) -> Vec<PathBuf>
    // Some(filter) => !filter.should_ignore(path, None)
    // None         => !is_hard_noise_path(path)

// 结构事件：只排除 .git / .DS_Store，**不过滤 gitignore**
pub(super) fn structure_event_paths(paths, is_structure_change) -> Vec<PathBuf>
    // filter(|path| !is_hard_noise_path(path))
```

注释原文（结构事件）："ignored 节点本身仍在文件树展示，因此结构变更不能因 .gitignore 被丢弃"。

`src/common/file/watcher/manager/callbacks.rs`：结构事件（`Create`/`Remove`/`Modify(Name)`）
→ `tree_debounce_tx`（并投递 `WatchMaintenance`，但 macOS 上 `on_dir_added` 对非 Selective 直接 no-op）。

**结论：macOS 上 `target/**` 的 Create/Remove 会一路发到前端。**

## 3. 背压 caps：溢出方向是"扩大爆炸半径"

`src/common/file/watcher/debounce.rs`：

- `FILE_CHANGED_TRAILING_MS = 200` / `FILE_CHANGED_MAX_WAIT_MS = 1500` / `FILE_CHANGED_MAX_PATHS = 5000`；
- `TREE_CHANGED_TRAILING_MS = 500` / `TREE_CHANGED_MAX_WAIT_MS = 1500` / **`TREE_CHANGED_MAX_DIRS = 64`**：

```rust
if dirs.len() > TREE_CHANGED_MAX_DIRS {
    log::debug!("... {} affected dirs exceed cap, sending full refresh");
    dirs.clear();   // 空 dirs = 前端全树刷新
}
```

**结论：一次 `cargo build` 产生的父目录若 >64 个 → 前端全树重扫。**

## 4. 忽略语义实现（gitignore.rs）

- `is_hard_noise_path()`：仅 `.git` 与 `.DS_Store`。
- `should_ignore_own(path, is_dir)`：读目录层用（自匹配、不含祖先上行）→ 剪枝粒度。
- `should_ignore(path, is_dir: Option<bool>)`：watcher 事件用（`matched_path_or_any_parents`）。
- 显式测试 `git_ignore_filter_does_not_hide_non_ignored_source_dirs`：
  名为 `build`/`dist`/`out`/`coverage`/`node_modules`/`target` 的真实源码目录，
  **在未被 .gitignore 忽略时不得被误伤** → 禁止硬编码目录名黑名单。

## 5. 读层：ignored 是叶子节点，ignored 目录按需展开已可用

`src/common/file/services/tree_read.rs::read_dir_recursive`：

- `.git` 硬过滤；
- ignored 目录 → push 一个 `children: vec![]`、`ignored: true` 的节点，**不下递归**；
- **无条目上限**（`nodes` 无 cap）。

前端：

- `src/features/file/hooks/useFileTreeSync.ts::makeLoader`：
  `dirPath ? 1 : DEFAULT_TREE_DEPTH` → 非根目录**单层懒加载**；
- `src/features/file/hooks/useFilePanelState.ts::handleToggleDir` → `onExpandDir(path)`，
  **对 `ignored` 无特殊分支**。

**结论：R7 的"点击再加载"已是现状；缺的是条目上限。**

## 6. 组装与生命周期（manager/core.rs）

- 每单元一套：`RecommendedWatcher`（整树/选择性注册）+ `GitStatusWorker` + `ThrottleScheduler`
  + `DebounceSender` + `TreeChangeDebounceSender` + `git_meta` watcher（`HEAD`/`index`/`refs`）
  + heartbeat（10s）+ perf 引导线程。
- `gitignore_filter`：git 仓库时 `GitIgnoreFilter::new(root)`（`reload()` 内部 `WalkBuilder` 全树找 `.gitignore`）。
- 挂载模型 D-B：只挂当前视图单元（`mount_only` / `release_except` / `unwatch`）。
- 快照：push（worker）与 pull（`record_computed`）双生产者，`version` 由 `store_snapshot` 统一盖章。

## 7. 与 §14 不变量的关系

`.trellis/spec/backend/git-domain.md §14`：`被监听/被触发重算的输入集合 ⊇ 派生值依赖的输入集合`。

逐派生值核对（改造前必须成立）：

| 派生值 | 依赖是否含 ignored | 备注 |
| --- | --- | --- |
| `GitStatusSnapshot`（entries/branch/ahead/behind） | 否（porcelain 不含 ignored） | 安全 |
| 文件树（ignored 目录为叶子灰节点） | 仅"边界存在性" | 由父目录（可见）监听覆盖 |
| 已打开文件的内容刷新 | **是** | **例外**：现已被 gitignore 过滤（既有行为） |
