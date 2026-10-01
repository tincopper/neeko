# Git 域规范（历史展示范围 + refs 分类 + stash）

> 后端 `common/git/` 与 `git/commands.rs` 的可执行契约，防止历史展示范围与 refs 分类回归。

---

## 1. 历史展示范围 = 当前 checkout 分支（HEAD）

**规则**：`get_commit_log`（`operations.rs` 的 transport 版与 `local.rs` 的同步版）必须固定
`git log --format=... --decorate=full --topo-order HEAD`，**禁止使用 `--all`**。

**原因**：`git log --all` 会遍历所有 refs 命名空间（`refs/synara/*`、`refs/aider/*`、`refs/stash` 等），
把第三方工具私有 checkpoint refs 混入用户历史视图。HEAD 范围语义：展示当前 checkout 分支的提交，
分支切换由 Changes 面板的 BranchSwitcherPanel 完成，历史自动跟随（前端 `onRefreshGit → refresh` 链路）。

**代码参照**：`src-tauri/src/common/git/operations/`（`get_commit_log`）、
`src-tauri/src/common/git/local/`（`get_commit_log`）。两处必须保持同一「HEAD + refs 过滤」语义。

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
- **护栏**：`tools/guards/checks/check_worktree_byte_assertions.py` 检出「read_to_string 绑定变量被
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

## 8. 路径文本输出契约（C 转义 / `-z`）

**第一性原理**：git 的**文本**输出（`status --porcelain` / `ls-files` / `diff --numstat` /
`--name-status`）在 `core.quotePath` 默认开启时，对含非 ASCII / 特殊字符的路径做
**C 风格转义 + 整体加双引号**：

```
git ls-files --others --exclude-standard -- test/     ->  "test/\346\265\213\350\257\225.txt"
git ls-files --others --exclude-standard -z -- test/  ->  test/测试.txt        （-z 不转义）
```

未解码即**下游全线错位**：UI 显示乱码、按路径建索引不命中（stats 合并不上）、staging/diff 命令
拿到引号 + 转义的伪路径、目录展开拿它当 pathspec 找不到目录（2026-09-24 现场缺陷）。

**规则**：

- **文本输出一律在解析入口解码**：`parsers::quoting::unquote_git_path` 是**唯一**解码点，已接入
  `parse_status_line`（rename 两侧按 token 扫描 —— 引号内的名字本身可以含 ` -> `）、
  `parse_numstat_line`、`parse_numstat_with_status`。禁止在消费侧（建索引 / 拼命令 / 显示）
  各自处理转义形态。
- **能用 `-z` 就用 `-z`**：NUL 分隔且不做转义，天然免疫（`operations::get_untracked_files`、
  `status_worker::collapsed_probe` 的探测均走 `-z`）。用 `-z` 时**不要 `trim()`** —— 文件名可以
  合法地含首尾空格，只丢弃末尾 NUL 切出的空片段。
- **不要在调用点撒 `-c core.quotePath=false`**：要求所有调用点一个不漏，且无法处理**必须**转义的
  路径（含引号 / 控制字符）。
- **两侧形态必须一致**：`parse_numstat_with_status` 把 `--numstat` 与 `--name-status` 按路径合并，
  一侧解码一侧不解码会静默取不到 status（退化为默认 `M`）。

**已知残留**：rename 在 `--numstat`（`old => new`）与 `--name-status`（`R100\told\tnew`）的形态与
`status`（`old -> new`）不同，提交 / 暂存列表的 rename 行仍取不到新名（2026-09-24 记录）。

**回归测试**：`parsers::quoting::tests::*`（八进制 / 简单转义 / 半截引号 / 1–3 位八进制）、
`parsers::status::quoted_path_tests::*`（非 ASCII、折叠目录尾斜杠、名字含 ` -> ` 的 rename）、
`parsers::numstat::quoted_path_tests::*`、
`parsers::commit::stash_parse_tests::quoted_non_ascii_paths_are_decoded_and_still_merged`、
集成 `git_test::get_untracked_files_returns_raw_non_ascii_paths`。

**改共享解析层必须跑全量 `cargo test`**：只跑新增用例过滤（如 `--lib quoted_`）会漏掉既有契约 ——
首版实现把非引号 rename 也走了 token 扫描，打挂 4 条既有 rename 测试，全量测试才发现。

## 9. 只读 git 语义单点注入（`GIT_OPTIONAL_LOCKS=0`）

**契约**：一切只读 git 调用（status / rev-parse / ls-files 等）**不得刷新 `.git/index`**——
否则与 IDE / 用户 git 争 index 锁，实测挡住过用户 `git commit`（2026-09-24 缺陷）。

**单一事实源在执行层**，业务代码**禁止**再逐点补 opts / CLI 标志：

1. `core::exec` 的 `spawn_target()`（本地 facade 唯一 spawn 入口）：`cmd == "git"` 时自动补
   `GIT_OPTIONAL_LOCKS=0`（`collect` / `run` / `spawn_with` / `collect_blocking*` 全覆盖）；
2. `common/git/transport` 的 `run_git_opts` / `run_git_with_stdin` 共用 env 组装处：
   **三端（Local / WSL / SSH）同时生效**（WSL/SSH 把 env 渲染成远端 shell 前缀）。

构造点：`common/git/git_env.rs`（`with_optional_locks_disabled` 尊重调用方显式覆盖）。
已退役的散落机制：`status_worker` 的 `--no-optional-locks` CLI 标志与「老 git 回退」分支——
**回退分支正是当年漏锁语义的地方**。`readonly_opts()` 仅剩显式意图标注用途，勿再往里加锁语义。

**验证方式（行为断言，非 mock）**：`git status` 前后 `stat .git/index` 的 mtime 严格相等——
`git_env::tests` 与 `collect_blocking_git_status_does_not_refresh_index` 两条用例钉死；
写路径（stage/commit/stash/checkout）回归全绿证明 optional ≠ 必需。

**Wrong**：新增读命令时 `run_git(&args, wd)` 之外再手动拼 `--no-optional-locks` 或 opts env——
散落注入必然在下一处新增调用点被遗漏（info.rs / worktree.rs 两处缺口即前车之鉴）。
**Correct**：直接走 facade / transport 默认注入；发现读路径写 index 立即回来改注入点。

## 10. 写后 status 快照新鲜度契约（poke-and-wait）

**背景**：`snapshot()` 是 G2 D2 读接口（`get_worktree_changed_files`）的唯一数据源，而 status
worker 只在被信号触发时重算。discard / stage / commit 等 IPC 直接跑 git 命令改工作区，**不走
watcher**——不主动通知，快照停留在写前状态，读接口把陈旧快照当权威数据返回（「操作成功但
列表要手动刷新才更新」的根因）。

**契约**：任何经 IPC 的 git **写命令成功后**必须调用 `wait_status_fresh`（定义在
`git/services/status.rs`，命令层只调用 —— 红线 6）：

- 链路：命令层 → `run_blocking`（Condvar 等待是阻塞原语，**禁止**在 async 线程直呼）→
  `WatcherManager::poke_status_worker_and_wait(&RepoRef, RECALC_WAIT_TIMEOUT)` →
  `GitStatusWorker::check_and_wait`。**契约主键是仓库单元（`RepoRef`），不是 project**
  （见 §12）：在 worktree 里 stage 却戳主仓的 worker，主仓 porcelain 一字未变 → 闸门判定
  「无变化」→ 什么都不更新，正是「操作成功但列表要手动刷新」的形态；
- 有界等待（1.5s 上限）：返回 `true` = 一轮**晚于写入启动**的重算已落地（emit 已冲刷，读接口
  拿到写后快照）；`false` = 超时 / 非 git 项目——由 `git-status-snapshot` 事件推送最终收敛；
- worker 侧以 **started/completed 进度对**判定「空闲」：早于写入启动的在飞迭代不可信，只等
  「采样时刻空闲之后启动」的新迭代。无变化不 emit 的迭代**必须照常推进 completed**，否则
  `check_and_wait` 会把「无变化重算」永远等成超时（实现时踩过的坑）。

**Wrong**：写命令成功后只 `worker.check()`（非阻塞投递）就返回——前端立即刷新仍读到写前快照。
**Correct**：`wait_status_fresh` 有界等待落地后再返回命令。

**判据的覆盖面是全称命题，不是清单**：契约写的是「**任何**改变 `f(HEAD, index, workdir)` 的
写命令」，因此除 stage / unstage / discard / commit 之外，`cherry_pick`、`revert`、
`checkout_branch` / `create_and_switch_branch` / `checkout_detached` / `rename_branch`、
`stash_apply` / `stash_pop`、`pull*` 同样要收口；命令只接受 `project_id` 时走
`wait_main_status_fresh`（被写入的单元必然是主仓单元），已带 `worktree_path` 的命令直接戳解析出的
那个 `RepoRef`。**不**收口的操作必须进护栏的显式台账并写清理由（`push` / `fetch` 只动 remote-tracking、
`create_branch` / `delete_branch` 不触碰 HEAD 与工作树、`create_tag` 不进 status、`stash_drop` 不改工作树）。

**单元生命周期**：`remove_worktree` / `rename_worktree` 除收口外还必须 `release_unit`
（释放该单元的挂载）。目录已不存在却留着挂载 = 线程与句柄白占 + 一份永不更新的快照继续被当权威
数据渲染（I1-b）。**释放用的 `RepoRef` 要在破坏性操作之前解析**：目录消失后 canonicalize 只能退回
词法归一，在符号链接根上（macOS `/var` ↔ `/private/var`）会算出与挂载时不同的 key，于是释放请求
打在不存在的挂载上、真正的挂载继续泄漏。

**为什么用静态护栏而不是单测**：命令层需要 `State<AppStateWrapper>` 才能执行，`cargo test` 造不出
那个组合根。接线因此由 `tools/guards/checks/check_repo_unit_identity.py` 的「写命令必须收口」判据
钉住（扫描 `git/commands/`，改变 status 的 operation 后必须出现三个收口函数之一）。

**测试**：`check_and_wait_confirms_recalc_landed_after_write`（等待返回时 emit 已冲刷）、
`check_and_wait_returns_true_without_emit_when_unchanged`（无变化不误判超时）、
`poke_status_worker_and_wait_confirms_fresh_snapshot_after_write`（manager 级快照已更新）、
`poke_after_unit_switch_recomputes_the_unit_that_was_written`（**按单元**戳：切换视图后 poke 打
在被写入的那个单元上，未挂载单元 poke 必须返回 false）、`check_and_wait_zero_deadline_times_out`（超时路径）；
前端 `WorktreeList.test.tsx`（删除/改名单元后槽位作废 + 激活态收口，且命令失败时不作废）。

## 11. GitExecError 携带 exit_code：禁止 stderr 嗅探判定行为分支

**契约**：需要按 git 失败原因分流时，优先用**确定性信号**（exit code、结构化字段），
stderr 文本匹配只允许用于「错误分类展示」（`classify_stderr` → Auth/Network 等 UI 分流），
**不得作为行为分支的依据**——文本随 git 版本 / 语言环境漂移，误匹配会把真实错误吞成兜底成功。

范例：unstage 兜底（discard.rs）——`git reset` 失败后用
`rev-parse --verify --quiet HEAD` 的 **exit 1**（git `die_no_single_rev`：`--quiet` 走 1、
报错版走 128）判定 unborn 分支，才走 `rm --cached`；HEAD 存在时一律传播真实错误。
回归钉子：`discard_paths_should_not_trust_stderr_sniff_when_head_exists`（stderr 偏说
"unknown revision" 而 HEAD 实际存在时，兜底不得触发）。

## 12. 仓库单元身份（RepoRef）与 status 生产者单源

**第一性原理**：`git status = f(HEAD, index, workdir)`，而 linked worktree 的这三者**全都
独立**（只共享 object DB）。所以一个 project 在 git 语义下是 `1 + N` 个仓库单元，不是 1 个。
以 `project_id` 为身份的一切设计都会在同一处必然出错：worktree 视图没有权威生产者（列表不
更新、要靠手动刷新）、与主仓共用一个槽（串 main 内容）。2026-09 的重构把身份补到真实粒度，
并**删除**了为此而存在的第二实现，而不是在旁边加分支。

**身份**：`common/git/repo_ref.rs` 的 `RepoRef{project_id, project_root, worktree}`，
`key()` = `"{project_id}\u0000{identity(worktree path)}"`（主仓 `worktree = None` ⇒ key 以
NUL 结尾）。选 NUL 做分隔符是因为它是 POSIX 路径里唯一不可能出现的字符 —— 分隔符可证无歧义，
`parse_key` 因此是单射。路径身份的唯一入口是
`common/git/unit_path.rs` 的 `UnitPath::resolve`（红线 8 / 12；见下方「身份字母表」）。
前端 `shared/utils/repoRef.ts` 与之同形，两侧靠
golden 测试钉住（`golden_key_format_matches_frontend_contract` ↔ `repoRef.test.ts`）——
「同一 key 两处各自实现」一定会漂移，这是唯一防线。
`RepoRef` 刻意**不**携带 `ExecTarget`：后者不实现 `Hash/PartialEq`，且目标是**连接**属性不是
**身份**属性（同一单元在 Local/WSL 下是同一个 git 仓库单元）。

**生产者**：一个单元一套资源（worker + file watcher + git-meta watcher），
`WatcherManager` 的 `watchers` / `snapshots` 主键一律 `RepoRef::key()`。

- push 生产者 = 挂载中的 `GitStatusWorker`；pull 生产者 = `record_computed`（WSL / SSH /
  未挂载单元，例如侧栏要为每个 worktree 取计数）。两者产出同一种 `GitStatusSnapshot`、
  进同一张表。
- **`version` 由注册表统一盖章**（`store_snapshot`）：号源必须只有一个。生产者自带序号
  （worker 私有计数器从 1 起算、pull 另按 `prev+1`）交错后必然出现平手或回退，而前端按
  version 做单元内乱序闸门 —— 被丢弃的那一次恰恰是「数据已经新了、界面还留着旧的」。
  事件载荷与槽位数据因此同源同号。
- **`version` 号段跨挂载周期单调，快照数据不跨**：`store_snapshot` 的取号来自
  `version_floors`（每单元最高水位），不是槽位里那份快照。释放（`release_one` /
  `release_except` / `unwatch`）**只作废数据，不作废号段**。
  反例（2026-09-29 真 app 手测日志暴露，13 次推送全是 `v1`）：号段随槽位一起归零时，
  「切走 → 释放 → 切回」后 worker 的第一份快照永远是 `v1`，而前端槽位里可能还留着切走前的
  `v3`（**切项目**这条路上没人作废它，`invalidateStatus` 只在 worktree 切换时发），
  `version <= prev` 于是把这份**更新**的数据判成旧的丢掉 —— 界面继续显示离开时的旧快照，
  正是 issue #2「要手动刷新才恢复」的形态。号段只在项目移除时随挂载一起回收
  （`unwatch_project`），规模以「项目 × 该项目的单元数」为界。
- **pull 不得覆盖挂载中单元的既有快照**（`record_computed` 回读即返）：pull 的 git 子进程
  耗时以百毫秒计，晚到的 pull 若照常写表，注册表盖的号还会让它看起来比它覆盖的 push 更新。
  冷挂载窗口（已挂载、尚无快照）仍然登记 —— 那正是 pull 存在的意义。

**挂载唯一入口（已被护栏钉住）**：`set_active_repo_unit` → `git/services/status.rs::activate`，语义 =
释放该项目下其它单元 → 挂载目标单元 → 有界等待首个快照；生产代码里 `WatcherManager::watch` 的调用点由护栏第 5 类判据限定为**只有** `activate`（实测破过一次：`app.rs` 启动恢复与 `set_active_project` 各按项目预挂主仓单元，于是每次启动都有两个发起点，日志报 `already watched`）。每项目同时**至多一套**挂载资源
（用户决策 D-B）。前端唯一发起点是 `app/hooks/useActiveRepoUnitSync.ts`；用户动作（点
worktree、切回主仓）只写激活态，不直接发命令 —— 挂载/释放必须与「当前视图」严格一致，两个
发起点就有时序差。

**实现时踩过的顺序坑**：`watch()` 里「作废切走前快照」那句必须在 `worker.check()` **之前**。
留在函数尾部时，worker 线程可以在 `watch()` 返回前就插入首个快照，随后那句把它删掉 ——
表现为「已挂载却读不到权威数据」，且只在首轮落地够快时复现（`linked_worktree_edit_pushes_
versioned_snapshot_without_manual_poke` 就是为钉这条顺序而写红的）。

**未挂载 = 未知，不是「无变更」**：`snapshot()` 返回 `None` 时读接口必须失败让前端渲染空态，
不得退化成空列表 —— 把「没有生产者」说成「没有改动」是伪造事实。

**身份字母表（identity）与执行形态（exec）是同一个值的两个渲染**（2026-10-01 起）：唯一入口
`common/git/unit_path.rs::UnitPath::resolve`，且**只在后端**。前端持有/持久化的 worktree 路径
必须全部来自后端回传（`git worktree list` 条目、快照的 `worktree_path`、
`canonical_worktree_path` 命令），且它拿到的是 **identity** 渲染。

| 渲染 | 字母表 | 消费者 |
| --- | --- | --- |
| `identity()` | **平台无关**：`/` 分隔、无 `\\?\`/`\\.\` 前缀、盘符 ASCII 大写、UNC → `//server/share/…`、无尾分隔符 | `RepoRef::key()` / `worktree_path()`、IPC `Worktree.path`、watcher·diff·status 槽位、前端 `RepoKey` |
| `exec()` | **宿主形态**（存在 → `fs::canonicalize` 原样，Windows 含 `\\?\`；不存在 → 调用者拼写） | git argv、`std::fs`、notify 根、`strip_prefix`、gitignore `same_root`、缓存键前缀、`file/commands.rs::resolve_base` |

不变量（φ 的判据，违反即同一单元裂成两个 key → 侧栏数据空白 / 激活态反复回落主仓）：

- **I1 写法无关**：`p`、`p/`、`p/./`、符号链接形态 → 同一 identity（Local 存在时 canonicalize）；
- **I2 区分性**：不同对象 → 不同 identity（**不**做大小写折叠、**不**做 Unicode 归一 ——
  在大小写敏感文件系统上折叠会把两个对象并成一个）；
- **I3 时刻无关**：`git worktree add` / `move` 的目标**尚不存在**时，identity = 
  `canonicalize(最深已存在祖先) ⊕ 尾分量` —— 不锚定就会「创建前 `\\?\…\new-wt` / 创建后
  另一个串」，这正是 Windows CI 上 `worktree_nonexistent_path_is_lexically_normalized` 暴露的形态。
  `exec` 在此时保持调用者拼写（那正是将要被创建的字节），两个渲染因此**允许不同**。
- **非目标**：Unicode NFD/NFC 归一、大小写不敏感文件系统上输入大小写的折叠、
  `\\?\Volume{GUID}` 形态（原样保留）。

平台差异（verbatim 剥除、盘符规范化、UNC 渲染）在 `platform/path_identity/`（红线 10）：
规则体是纯字符串函数（三端编译、三端测试），平台差异只体现在**选择**上；远端路径走
`posix_render`，与宿主平台无关。

三个实测踩过的形态陷阱：
- session 恢复：旧 session 里可能是 `/tmp` 这类符号链接形态，而清单是 `/private/tmp`，
  两侧不同形 ⇒ 存活校验把刚恢复的 worktree 立刻判没，挂载在 main ↔ worktree 反复翻。
  解法是恢复流程先请后端归一（`canonical_worktree_path` 命令）再比清单；
- 破坏性操作（`remove_worktree` / `rename_worktree`）要释放的单元身份必须在**操作之前**解析，
  目录消失后归一只剩祖先锚定形态，算出的 key 与挂载时的 key 不同，释放会打空；
- **远端路径不得进宿主路径语义**：`UnitPath::resolve` 按 `ExecTarget` 分叉 ——
  Local 走宿主语义（`exists` / `canonicalize`），WSL / SSH 走**纯字符串**
  `posix_render`。`std::path` 的分隔符是**宿主** OS 的属性，而这条路径的消费者是
  **远端 Linux**：Windows 宿主上 `Path::components("/home/u/p")` push 回来变成 `\home\u\p`，
  两层后果 —— ① 身份分叉：同一远端单元在 Windows 与 macOS 上算出两个 key；
  ② 命令参数失效：WSL 执行器是 `cd <dir> && exec …`（`common/executor/wsl.rs`），
  `cd \home\u\p` 必失败 ⇒ Windows 宿主上 WSL/SSH 项目的 changes 直接瘫痪。
  判据因此必须与宿主 OS 无关（纯字符串断言，不硬编码宿主绝对路径 —— 红线 13）：
  `remote_identity_is_posix_and_host_independent`（SSH / WSL 两个 target，
  POSIX 形态不被改写、`.` 与尾分隔符收敛、相对性保留、根不塌成空串）。

**判死只能有一个点**：「激活单元是否还存在」由前端的 canonical 清单校验（`useAppShellData`）
单点判定。挂载发起点若在 IPC 失败时也回落主仓，就构成第二个判死点 —— 冷启动首轮快照超时是
正常现象（快照由 worker 异步产出），两点互判会让挂载抖动。挂载失败的正确语义是：**保留激活
意图、槽位置为未知、放开同意图的重发门闸**。

**挂载回收是全局的，且必须原子**：`activate()` 只调 `WatcherManager::mount_only(repo, sink)` ——
它在**同一个临界区**内完成「释放除目标之外的所有挂载（跨项目也算）+ 挂载目标」；命令层不再按项目
预挂主仓单元（旧实现在 `app.rs` 启动恢复与 `set_active_project` 里各挂一次，实测每次启动都出现
「先挂主仓、随后改挂 worktree」的两个发起点）。

原子性是**不变量属于资源所有者**的直接后果：D-B（全局至多一套挂载）不能靠调用方记得「先
release 再 watch」的顺序维持 —— 两个并发的 `activate`（快速切项目 / 连点）会在两步之间交错成
`c1.release, c2.release, c1.watch, c2.watch` ⇒ 两套挂载常驻（线程与句柄泄漏 + 同一变更推两份
快照）；同单元的并发 `watch` 也会穿过 `watch()` 的 check 到 insert（幂等只在单线程下成立）。
落点是 `mount_lock: Arc<Mutex<()>>`，`release_except` 公共面同样取该锁（语义不变），内部走无锁
内核 `release_except_inner` 以免自死锁；每单元的释放原语只有 `release_one` 一个。

**退役清单**（不得回潮，护栏 `tools/guards/checks/check_repo_unit_identity.py` 按符号钉）：
libgit2 第二 status 引擎（`get_worktree_changed_files` / `get_changed_files_from_repo`）、
`version: 0` 无语义载荷、`resolve_validated_work_dir`（校验时 canonicalize、返回时丢弃）、
跨 worktree 补挂广播（`rearm_worktrees_if_needed` / `resolve_worktree_roots` /
`WorktreeMetaChanged` / `has_worktrees`）、前端 `applyGitStatus` / `versionGateAccepts` /
`allowEqual` / `mergeGitInfoForStore` / `worktreeStore` 全局镜像字段、后端单串归一入口
`path_guard::canonicalize_worktree_path`（一个返回值同时当身份与宿主路径 —— 见上方「身份字母表」）。

**测试**：`repo_ref.rs`（key 形态 / parse 单射 / 身份一致性 / **创建前后同 key**）、
`common/git/unit_path.rs`（**I1 写法无关 / I3 时刻无关 / 两个渲染同对象 / 远端形态与宿主 OS 无关**）、
`platform/path_identity/rules.rs`（Windows 形态渲染纯字符串用例，三端运行）、
`path_guard`（`..` / NUL / 非 UTF-8 拒绝）、`manager/lifecycle_tests.rs`（两单元独立槽、
poke 打对单元、编辑即推送、未挂载兄弟单元零泄漏、pull 不覆盖 push、unwatch/unwatch_project
收口、**并发挂载不同单元 ⇒ 恰好一套挂载**、**并发挂载同单元 ⇒ 只建一套 watcher**）。

## 相关文件

- `src-tauri/src/common/git/repo_ref.rs` — 仓库单元身份（`RepoRef` / `WorktreeRef` / key 契约）
- `src-tauri/src/common/git/unit_path.rs` — 路径身份唯一入口（identity / exec 双渲染 + I1/I2/I3）
- `src-tauri/src/platform/path_identity/` — 身份字母表的平台渲染规则（红线 10）
- `src-tauri/src/common/git/path_guard.rs` — 工作树路径与仓库内相对路径的**校验**（归一不在此）
- `src-tauri/src/common/git/refs.rs` — refs 分类纯函数
- `src-tauri/src/common/git/parsers/` — `status` / `numstat` / `commit` / `quoting`（C 转义唯一解码点）
- `src-tauri/src/common/git/cache/` — `get_cached_worktree_diff` / `FileFingerprint` / LRU diff 缓存
- `src-tauri/src/common/git/status_worker/` — status 快照唯一计算路径（含折叠 untracked 目录内容摘要 `collapsed_probe.rs`）
- `src-tauri/src/git/services/status.rs` — 单元 status 读接口与挂载编排（`read_unit_status` / `activate` / `wait_status_fresh`）
- `src-tauri/src/common/file/watcher/manager/` — 按单元挂载的资源注册表（`watchers` / `snapshots` 主键 = `RepoRef::key()`）
- `src-tauri/src/common/git/operations/` + `local/` — `get_commit_log` / `get_stash_list` / `get_stash_files` / `get_file_diff` / `status_porcelain`
- `src-tauri/src/git/commands/` + `src-tauri/src/lib.rs` — 命令透传与注册
- `src/features/git/components/diff/useDiffData.ts` — 前端无状态 diff 消费者（git-status-diff / file-changed / 手动刷新驱动重拉）