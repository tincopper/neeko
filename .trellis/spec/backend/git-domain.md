# Git 域规范（历史展示范围 + refs 分类 + stash）

> 后端 `common/git/` 与 `git/commands.rs` 的可执行契约，防止历史展示范围与 refs 分类回归。

---

## 1. 历史展示范围 = 当前 checkout 分支（HEAD）

**规则**：`get_commit_log`（`operations.rs` 的 transport 版与 `local.rs` 的同步版）必须固定
`git log --format=... --decorate=full --topo-order HEAD`，**禁止使用 `--all`**。

**原因**：`git log --all` 会遍历所有 refs 命名空间（`refs/synara/*`、`refs/aider/*`、`refs/stash` 等），
把第三方工具私有 checkpoint refs 混入用户历史视图。HEAD 范围语义：展示当前 checkout 分支的提交，
分支切换由 Changes 面板的 BranchSwitcherPanel 完成，历史自动跟随（前端 `onRefreshGit → refresh` 链路）。

**代码参照**：`src-tauri/src/common/git/operations.rs`（`get_commit_log`）、
`src-tauri/src/common/git/local.rs`（`get_commit_log`）。两处必须保持同一「HEAD + refs 过滤」语义。

**禁止**：
- ❌ `git log --all` / `git log --branches` / `git log --remotes` 等混排多 refs 范围的调用
- ❌ 前端新增历史范围切换 UI（范围绑定 HEAD，切换发生在 Changes 面板）

## 2. refs 分类纯函数（`common/git/refs.rs`）

`parse_decorate_refs(decorate: &str) -> Vec<ParsedRef>` 解析 `%D` decorate 字符串，按 **refs 命名空间前缀**
分类，**不硬编码任何具体工具名**：

| decorate 输入 | 分类 | 短名示例 |
|---|---|---|
| `HEAD -> refs/heads/…` | Branch | `main` |
| `HEAD`（detached 单独） | Branch | `HEAD` |
| `refs/heads/…` | Branch | `feature` |
| `refs/remotes/…` / `HEAD -> refs/remotes/…` | Remote | `origin/main` |
| `refs/tags/…` / `tag: …` / `HEAD -> refs/tags/…` | Tag | `v1.0.4` |
| `refs/stash` / `HEAD -> refs/stash` | Stash | `stash` |
| 其它 `refs/*` 命名空间（`refs/synara/*`、`refs/aider/*`、`refs/bisect/*`…） | **丢弃** | — |

**规则**：
- `HEAD ->` 前缀只对 heads/remotes/tags/stash 四种已知命名空间放行；指向其它 `refs/*` 的
  `HEAD -> refs/xxx` 一律丢弃（工具私有 refs 永不渲染）。
- `stash` 属于用户自有状态，**必须保留**为 Stash 分类，与其它工具私有 refs 区别对待。
- `RefKind` serde 序列化为小写字符串（`branch`/`remote`/`tag`/`stash`），与前端 `ParsedRefKind` 对齐。

## 3. `CommitEntry` 的 refs 语义

- `refs: String`：**仅含可展示类别的过滤后 decorate 子串**（如 `main, origin/main, v1.0.4`），
  由 `parse_commit_log_output` 从 `refs_list` 短名 join 生成。空串时前端 `formatRefs` 天然返回 null。
- `refs_list: Vec<ParsedRef>`：结构化分类结果（新增字段，`#[serde(default)]` 保证向后兼容），
  前端可直接按 `kind` 染色渲染。

## 4. Stash 查询命令

- `operations::get_stash_list`：`git stash list --format=%gd%x00%gs%x00%H%x00%aI`，`parse_stash_list`
  解析 NUL 分隔；`branch` 从 `%gs` 前缀提取（`WIP on <b>:` / `On <b>:`），失败回退空串；空输出 → 空 Vec。
- `operations::get_stash_files`：`git stash show --numstat <selector>` + `--name-status <selector>`，
  解析复用 `parse_numstat_with_status`。
- 命令层（`git/commands.rs`）只做透传：`get_stash_list(project_id, worktree_path)` /
  `get_stash_files(project_id, selector, worktree_path)`，保持极薄；注册于 `neeko_invoke_handler!`。
- 三态（本地 / WSL / SSH）一律走 `GitTransport` 统一接口，禁止裸 `std::process::Command`。

### 4b. Stash 内容查看与操作命令

- `operations::get_stash_file_diff`：**`git stash show -p <selector> -- <path>` 不支持路径参数**
  （报 "Too many revisions specified"），必须用 `git diff <selector>^ <selector> -- <path>`（带
  `full_diff_context_arg` 上下文行数），解析复用 `parse_unified_diff` + `collapse_diff_context`。
- `operations::stash_apply`：`git stash apply <selector>`，**条目保留**；成功返回
  `StashActionResult { success: true }`。
- `operations::stash_pop`：`git stash pop <selector>`，**条目移除**；冲突时 git 返回非零，
  **条目保留**并返回 `success: false` + stderr 消息。
- **错误分流（`operations::stash_action_result`）**：`downcast_ref::<GitExecError>` 后按
  `ErrorKind` + 操作级 marker（`STASH_OP_FAILURE_MARKERS`：`CONFLICT (content):` /
  `would be overwritten by merge` / `log for 'stash' only has` / `No stash entries found.` 等，
  同时检查 stderr 与 stdout）判定 —— 操作级失败 → `success: false` + git 原始消息；系统级错误
  （Auth / AuthSsh / Network / Ambiguous / NoUpstream）与非 `GitExecError`（spawn 失败、timeout）
  → 原样上抛 `Err`，走 `AppError` 传导，禁止伪装成 `success: false`。
- **冲突消息源**：真实 3-way 冲突的 `CONFLICT (content): ...` 落在 **stdout**（stderr 为空），
  本地改动冲突（`would be overwritten by merge`）在 stderr；`stash_action_result` 在 stderr 为空时
  从 stdout 提取首个 CONFLICT 行作为 `message`，避免 toast 空消息。
- `StashActionResult { success: bool, message: String }`：前端据此决定 toast 文案与是否刷新。
- 命令层透传：`get_stash_file_diff(project_id, selector, path, collapse)` /
  `stash_apply(project_id, selector, worktree_path)` / `stash_pop(project_id, selector, worktree_path)`。

### 4c. Stash diff 前端复用

- `DiffSource` 增 stash 变体 `{ type: 'stash'; projectId: string; selector: string }`；
  `useDiffData.fetchDiff` 对 stash 分支优先走 `ProjectCommands.getStashFileDiff`（`DiffView` 透传
  `commands` prop），无 commands 时回退 `gitApi.getStashFileDiff`。
- `StashPanel` 点击文件**打开 diff tab**（复用 history 打开 diff 文件的机制：git feature 域 hook
  `useOpenStashDiff` → `addTab` + `activateTab`，diffSource 为 stash 变体），tab 标题 `stash@{n}: <message>`；
  Apply / Pop 在底部操作栏（列表视图），操作中 loading 禁用，成功后刷新列表 + 触发 Git 面板刷新。

## 5. Diff 缓存正确性契约（`common/git/cache.rs`）

**原则**：diff 是派生值 `f(HEAD, index, 工作区文件)`，缓存正确性靠**输入指纹自洽**，
不依赖任何事件失效（notify 会丢事件；事件只影响前端"何时重拉"的新鲜度，不影响正确性）。

- **唯一缓存所有者 = 后端**：`DIFF_CACHE`（LRU，cap 50）是 diff 内容唯一缓存；前端是**无状态消费者**，
  每次展示/聚焦直接 `get_file_diff`，不得持有跨挂载的模块级 diff 缓存。
- **工作区 diff**（`get_cached_worktree_diff`）：命中时重新 `stat` 文件，指纹 `(mtime_ns, size)` 一致
  才返回缓存，不一致即重算并刷新；文件删除/新增（`None↔Some`）同样触发重算。
- **键隔离**：`{repo}:{path}:collapse={bool}`，collapse 不同各自缓存。
- **失效**：`invalidate_repo_caches` 仅覆盖 git 写操作（branch 切换 / commit / stash 等 HEAD 或 index 变化）；
  普通文件编辑**不**清缓存——由指纹校验兜底，保证"后端永远返回当前磁盘真相"。
- **远程/WSL**：`open_repo` 仅 `ExecTarget::Local` 返回 `Some`，其余走 shell 分支**不缓存**（每次现算）；
  前端靠"显示即拉 + 手动刷新"保证新鲜。
- **阻塞 I/O**：`capture_file_fingerprint` 内含 `std::fs::metadata`，只能在 `spawn_blocking` 内调用
  （`operations::get_file_diff` 已包裹）。

## 6. 测试要求

- `parse_decorate_refs`：branch/remote/tag/stash/HEAD 用例；`refs/synara/checkpoints` 被丢弃；
  `HEAD -> refs/synara/*` 被丢弃；空 decorate。
- `parse_stash_list`：selector/hash/message/branch/timestamp 解析；空输出。
- 集成：临时仓库含孤立 `refs/synara/checkpoints` 提交时，`get_commit_log`（HEAD）不包含该提交；
  decorate 含 tool refs 的提交其 `refs`/`refs_list` 不含 tool 项；stash list/files roundtrip。
- 缓存（`cache.rs` tests）：未变命中（fetch 仅一次）；文件修改/删除后重算；collapse 键隔离。

## 7. 换行边界契约（git 归一化视图 vs 工作区字节）

**第一性原理**：Git 客户端同时面对两个内容视图——

| 视图 | 含义 | 确定性 |
|---|---|---|
| git 归一化视图 | blob / diff / status 输出 | 受 `text`/`core.autocrlf` 影响时统一 LF，平台无关、**确定** |
| 工作区物化字节 | 磁盘上的真实字节 | 由平台 + git 配置（Windows 默认 `autocrlf=true` 转 CRLF）+ 环境注入共同决定，**不确定** |

**规则**：

- **测试**：禁止对工作区换行做字节级精确断言（`read_to_string` + `assert_eq!(content, "...")` 在
  Windows CI 必挂，回归样例 `git_test::stash_apply_restores_changes_keeps_entry`）。测试仓库必须用
  确定性 builder：集成侧 `tests/unit/support.rs::TestRepo`、lib 侧 `operations.rs::init_repo`，
  双保险 = 仓库级 `core.autocrlf=false` + 提交 `.gitattributes * -text`（属性级钉死、随仓库走、
  抵抗全局配置与环境注入）。必须断言工作区字节时走行尾无关比较（`support::assert_content_eq` /
  `assert_worktree_eq`），或优先在 git 归一化视图（status/diff）上断言。
- **生产**：禁止向 git 调用注入 `-c core.autocrlf=...` 或强制换行语义——必须尊重用户仓库的换行
  设置。工作区字节按不透明平台数据处理（解析走 `.lines()` 等 CRLF 兼容路径，如
  `operations.rs::get_file_diff` 的 fallback）。
- **护栏**：`.trellis/scripts/check_worktree_byte_assertions.py` 检出「read_to_string 绑定变量被
  assert_eq! 字节级引用」模式，已接入 `pnpm lint` 与 CI（backend-check ubuntu）。

**生产审计（L4）**：`common/git/` 5 处工作区字节读点全部 CRLF 兼容——`operations.rs:1106`
（`get_file_diff` fallback）、`operations.rs:1193`（untracked 行数）、`local.rs:310`（行数
fallback，主路径 `wc -l` 按 `\n` 计数）、`local.rs:514`（git2 fallback，其 diff 行内容另有
`trim_end_matches('\r')`）、`local.rs:1412`（untracked diff fallback）——均走 `.lines()`。
`transport.rs` 的 `write_all(stdin)` 写入 git 子进程 stdin（如 `git apply --stdin`），非工作区
字节。无任何生产 autocrlf 注入。回归测试：`git_test::file_diff_new_crlf_file_strips_carriage_returns`
（git2 分支）`operations::file_diff_shell_fallback_crlf_file_strips_carriage_returns`（shell 分支，
WSL/SSH）+ `parse_unified_diff_crlf_input_strips_carriage_returns`（解析器）。约定详见
`docs/ARCHITECTURE.md` 6.1。

## 相关文件

- `src-tauri/src/common/git/refs.rs` — refs 分类纯函数
- `src-tauri/src/common/git/parsers.rs` — `parse_commit_log_output` / `parse_stash_list` / `parse_numstat_with_status`
- `src-tauri/src/common/git/cache.rs` — `get_cached_worktree_diff` / `FileFingerprint` / LRU diff 缓存
- `src-tauri/src/common/git/operations.rs` + `local.rs` — `get_commit_log` / `get_stash_list` / `get_stash_files` / `get_file_diff`
- `src-tauri/src/git/commands.rs` + `src-tauri/src/lib.rs` — 命令透传与注册
- `src/features/git/components/diff/useDiffData.ts` — 前端无状态 diff 消费者（git-status-diff / file-changed / 手动刷新驱动重拉）