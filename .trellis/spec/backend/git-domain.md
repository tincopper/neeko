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

1. `core::exec` 的 `spawn_target()`（本地 facade 的 **argv 形态**唯一 spawn 入口）：`cmd == "git"`
   时自动补 `GIT_OPTIONAL_LOCKS=0`（`collect` / `run` / `spawn_with` / `collect_blocking*` 全覆盖）。
   script 形态（`collect_script` / `spawn_script`）不经此入口 —— 它的 `cmd` 是环境 shell
   （`sh` / `cmd`），永不为 `git`，本就不在默认环境表内；
2. `common/git/transport` 的 `run_git_opts` / `run_git_with_stdin` 共用 env 组装处：
   **三端（Local / WSL / SSH）同时生效**（env 经 `SpawnOptions` 由 executor 送达，见
   `backend/command-execution.md`）。

构造点：`common/executor/env_defaults.rs` 的命令默认环境表 + `with_default_env`（尊重调用方
显式覆盖）。**已全部退役的散落机制**（本不变量历史复发 4 次的完整清单，勿再重犯）：

1. 调用点漏传 opts（`operations/info.rs` / `worktree.rs`）；
2. `status_worker/worker.rs` 的 `--no-optional-locks` + 「老 git 回退」分支；
3. `operations/support.rs` 的 `readonly_opts()` / `READONLY_ENV` 逐点注入；
4. `status_worker/collapsed_probe.rs` 的第二处 `--no-optional-locks`。

**强制单一源（防复发）**：`tools/guards/checks/check_git_optional_locks_single_source.py` ——
`GIT_OPTIONAL_LOCKS` / `--no-optional-locks` / `optionalLocks` 字面量在整个
`src-tauri/{src,tests}` 的 `.rs` 中**只允许出现在一个文件**里（`common/executor/env_defaults.rs`
数据表 + 其单测），**注释里也不允许复述**（要说明请指向该文件）。删掉散落副本只是清今天，
护栏才能拦住明天；选“单文件唯一”而非“剔除注释后再匹配”，是为了不引入自写的 Rust
词法扫描器（持续维护 + 漏报面），且 `grep` 全仓只剩一处文件本身就是最好的可读性。

**验证方式（行为断言，非 mock）**：`git status` 前后 `stat .git/index` 的 mtime 严格相等——
`common/executor/env_defaults.rs::tests`、`transport/tests.rs::git_status_does_not_refresh_index`
与 `collect_blocking_git_status_does_not_refresh_index` 三条用例钉死；
写路径（stage/commit/stash/checkout）回归全绿证明 optional ≠ 必需。

**Wrong**：新增读命令时 `run_git(&args, wd)` 之外再手动拼 `--no-optional-locks` 或 opts env——
散落注入必然在下一处新增调用点被遗漏（info.rs / worktree.rs 两处缺口即前车之鉴）。
**Correct**：直接走 facade / transport 默认注入；发现读路径写 index 立即回来改注入点。

**已知边界（勿踩）**：facade 的注入键是 `opts.cmd == "git"` —— 若用 `sh -c "git …"` 包裹调用，
注入会**静默失效**。transport 已不再自拼 shell（统一走 `SpawnOptions` + executor，见
`backend/command-execution.md`）；新增本地 git 调用一律令 `cmd == "git"`，不要自行 shell 包裹。

**谁的 git 走哪条路**：Local 同步桥（`status_worker` / `collapsed_probe`）走 `core::exec` facade；
而 **WSL/SSH 的 git 一律走 `GitTransport`** —— facade 的默认 env 设在本地 `wsl.exe`/`ssh`
进程上、无法穿透到远端，经 facade 跑远程 git 会静默丢掉只读语义（除下方已知例外外，本仓**无**
此类调用；曾有唯一实例 `pr::checkout_pr`，因零调用方作为死代码删除）。

**已知例外（已评估，勿误改）**：`common/file/services/ignored_cache.rs::fetch_remote_ignored_paths`
在 WSL/SSH 上经 `core::exec` facade 跑
`git ls-files --others --ignored --exclude-standard --directory` 取被忽略路径集合。
它**不构成只读语义缺口**：§9 的实测表已钉死 `git ls-files --others` 不刷新 `.git/index`（非争用源）；
且该调用属文件树读取，经 `GitTransport` 反而把文件域耦合到 git 传输层。
若未来把 `ls-files` 换成会写 index 的命令，必须改走 transport。

## 10. 写后 status 快照新鲜度契约（poke-and-wait）

**背景**：`snapshot()` 是 G2 D2 读接口（`get_worktree_changed_files`）的唯一数据源，而 status
worker 只在被信号触发时重算。discard / stage / commit 等 IPC 直接跑 git 命令改工作区，**不走
watcher**——不主动通知，快照停留在写前状态，读接口把陈旧快照当权威数据返回（「操作成功但
列表要手动刷新才更新」的根因）。

**契约**：任何经 IPC 的 git **写命令成功后**必须调用 `wait_status_fresh`（定义在
`git/services/status.rs`，命令层只调用 —— 红线 6）：

- 链路：命令层 → `run_blocking`（Condvar 等待是阻塞原语，**禁止**在 async 线程直呼）→
  `WatcherManager::poke_status_worker_and_wait(&WorkspaceRef, RECALC_WAIT_TIMEOUT)` →
  `GitStatusWorker::check_and_wait`。**契约主键是Workspace（`WorkspaceRef`），不是 project**
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
那个 `WorkspaceRef`。**不**收口的操作必须进护栏的显式台账并写清理由（`push` / `fetch` 只动 remote-tracking、
`create_branch` / `delete_branch` 不触碰 HEAD 与工作树、`create_tag` 不进 status、`stash_drop` 不改工作树）。

**单元生命周期**：`remove_worktree` / `rename_worktree` 除收口外还必须 `release_workspace`
（释放该单元的挂载）。目录已不存在却留着挂载 = 线程与句柄白占 + 一份永不更新的快照继续被当权威
数据渲染（I1-b）。**释放用的 `WorkspaceRef` 要在破坏性操作之前解析**：目录消失后 canonicalize 只能退回
词法归一，在符号链接根上（macOS `/var` ↔ `/private/var`）会算出与挂载时不同的 key，于是释放请求
打在不存在的挂载上、真正的挂载继续泄漏。

**为什么用静态护栏而不是单测**：命令层需要 `State<AppStateWrapper>` 才能执行，`cargo test` 造不出
那个组合根。接线因此由 `tools/guards/checks/check_workspace_identity.py` 的「写命令必须收口」判据
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

## 12. Workspace身份（WorkspaceRef）与 status 生产者单源

> 术语：`WorkspaceRef` / `CheckoutPath` 是 `workspace.checkout`（`Workspace` 的 git 属性）的身份与路径值对象。
> 领域分层定义见 [`docs/domain-model.md`](../../../docs/domain-model.md)（唯一定义处，本文不复述）。

**第一性原理**：`git status = f(HEAD, index, workdir)`，而 linked worktree 的这三者**全都
独立**（只共享 object DB）。所以一个 project 在 git 语义下是 `1 + N` 个Workspace，不是 1 个。
以 `project_id` 为身份的一切设计都会在同一处必然出错：worktree 视图没有权威生产者（列表不
更新、要靠手动刷新）、与主仓共用一个槽（串 main 内容）。2026-09 的重构把身份补到真实粒度，
并**删除**了为此而存在的第二实现，而不是在旁边加分支。

**身份**：`common/git/workspace_ref.rs` 的 `WorkspaceRef{project_id, project_root, worktree}`，
`key()` = `"{project_id}\u0000{identity(worktree path)}"`（主仓 `worktree = None` ⇒ key 以
NUL 结尾）。选 NUL 做分隔符是因为它是 POSIX 路径里唯一不可能出现的字符 —— 分隔符可证无歧义，
`parse_key` 因此是单射。路径身份的唯一入口是
`common/git/checkout_path.rs` 的 `CheckoutPath::resolve`（红线 8 / 12；见下方「身份字母表」）。
前端 `shared/utils/workspaceRef.ts` 与之同形，两侧靠
golden 测试钉住（`golden_key_format_matches_frontend_contract` ↔ `workspaceRef.test.ts`）——
「同一 key 两处各自实现」一定会漂移，这是唯一防线。
`WorkspaceRef` 刻意**不**携带 `ExecTarget`：后者不实现 `Hash/PartialEq`，且目标是**连接**属性不是
**身份**属性（同一单元在 Local/WSL 下是同一个 git Workspace）。

**生产者**：一个单元一套资源（worker + file watcher + git-meta watcher），
`WatcherManager` 的 `watchers` / `snapshots` 主键一律 `WorkspaceRef::key()`。

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

**挂载唯一入口（已被护栏钉住）**：`set_active_workspace` → `git/services/status.rs::activate`，语义 =
释放该项目下其它单元 → 挂载目标单元 → 有界等待首个快照；生产代码里 `WatcherManager::watch` 的调用点由护栏第 5 类判据限定为**只有** `activate`（实测破过一次：`app.rs` 启动恢复与 `set_active_project` 各按项目预挂主仓单元，于是每次启动都有两个发起点，日志报 `already watched`）。每项目同时**至多一套**挂载资源
（用户决策 D-B）。前端唯一发起点是 `app/hooks/useActiveWorkspaceSync.ts`；用户动作（点
worktree、切回主仓）只写激活态，不直接发命令 —— 挂载/释放必须与「当前视图」严格一致，两个
发起点就有时序差。

**服务层只依赖端口（依赖倒置，已被护栏铉住）**：`activate()` 收 `Arc<dyn WatcherEventSink>`，
不接收 `tauri::AppHandle`、也不自己 `new AppHandleSink` —— 交付适配器的构造留在命令边界
（`git/commands/query.rs::set_active_workspace`）。这样服务层可用测试替身（`CollectingSink`）
驱动：`status.rs` 的编排测试（注入 sink + 隔离 `AppStateWrapper` + tempdir 真实 git 仓）
覆盖「Local 走挂载 + 首份快照经端口投递」与「激活新单元释放旧单元（D-B 在编排层成立）」
—— 后者此前只在 `mount_only` 层被测，服务层组合无人验证。护栏 `check_service_no_delivery_dep`
钉住 `git/services/**` 不得出现 `tauri::` / `AppHandle` / `AppHandleSink`（注释除外）。

**远端 pull 分支已有代码级测试**（AC13 的代码层闭合）：`activate_with(…, &ExecTarget::Local,
has_push_producer=false)` 用**本地 transport** 驱动同一条分支（收口 + 现算 + 不挂载 + 不产生
watcher 事件），无需真机、也无需假 transport。判据：
`remote_branch_pulls_without_mounting_and_releases_the_previous_unit` 与
`read_workspace_status_of_an_unmounted_unit_computes_and_records`；真机验证降级为确认。

**实现时踩过的顺序坑**：`watch()` 里「作废切走前快照」那句必须在 `worker.check()` **之前**。
留在函数尾部时，worker 线程可以在 `watch()` 返回前就插入首个快照，随后那句把它删掉 ——
表现为「已挂载却读不到权威数据」，且只在首轮落地够快时复现（`linked_worktree_edit_pushes_
versioned_snapshot_without_manual_poke` 就是为钉这条顺序而写红的）。

**未挂载 = 未知，不是「无变更」**：`snapshot()` 返回 `None` 时读接口必须失败让前端渲染空态，
不得退化成空列表 —— 把「没有生产者」说成「没有改动」是伪造事实。

**身份字母表（identity）与执行形态（exec）是同一个值的两个渲染**（2026-10-01 起）：唯一入口
`common/git/checkout_path.rs::CheckoutPath::resolve`，且**只在后端**。前端持有/持久化的 worktree 路径
必须全部来自后端回传（`git worktree list` 条目、快照的 `worktree_path`、
`canonical_worktree_path` 命令），且它拿到的是 **identity** 渲染。

| 渲染 | 字母表 | 消费者 |
| --- | --- | --- |
| `identity()` | **平台无关**：`/` 分隔、无 `\\?\`/`\\.\` 前缀、盘符 ASCII 大写、UNC → `//server/share/…`、无尾分隔符 | `WorkspaceRef::key()` / `worktree_path()`、IPC `Worktree.path`、watcher·diff·status 槽位、前端 `WorkspaceKey` |
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
- **远端路径不得进宿主路径语义**：`CheckoutPath::resolve` 按 `ExecTarget` 分叉 ——
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

**退役清单**（不得回潮，护栏 `tools/guards/checks/check_workspace_identity.py` 按符号钉）：
libgit2 第二 status 引擎（`get_worktree_changed_files` / `get_changed_files_from_repo`）、
`version: 0` 无语义载荷、`resolve_validated_work_dir`（校验时 canonicalize、返回时丢弃）、
跨 worktree 补挂广播（`rearm_worktrees_if_needed` / `resolve_worktree_roots` /
`WorktreeMetaChanged` / `has_worktrees`）、前端 `applyGitStatus` / `versionGateAccepts` /
`allowEqual` / `mergeGitInfoForStore` / `workspaceStore` 全局镜像字段、后端单串归一入口
`path_guard::canonicalize_worktree_path`（一个返回值同时当身份与宿主路径 —— 见上方「身份字母表」）。

**测试**：`workspace_ref.rs`（key 形态 / parse 单射 / 身份一致性 / **创建前后同 key**）、
`common/git/checkout_path.rs`（**I1 写法无关 / I3 时刻无关 / 两个渲染同对象 / 远端形态与宿主 OS 无关**）、
`platform/path_identity/rules.rs`（Windows 形态渲染纯字符串用例，三端运行）、
`path_guard`（`..` / NUL / 非 UTF-8 拒绝）、`manager/lifecycle_tests.rs`（两单元独立槽、
poke 打对单元、编辑即推送、未挂载兄弟单元零泄漏、pull 不覆盖 push、unwatch/unwatch_project
收口、**并发挂载不同单元 ⇒ 恰好一套挂载**、**并发挂载同单元 ⇒ 只建一套 watcher**）。

## 13. 长操作超时策略与 Console 可见性（push / fetch / pull / commit）

**判据**：墙钟超时的正当用途是防「卡死」，而 push / fetch / pull / commit 的耗时由
pre-push/pre-commit hook 与网络决定、**没有上界**（pre-push 在本仓跑两套测试，分钟级）。
用墙钟兜它们必然把「正常慢」误判成失败 —— 2026-10-01 事故：push 的 hook 约 3 分钟，
应用 30s 上限先弹失败，而 git 进程并未被终止（超时只停止等待），远端状态未知。
对齐 VS Code 的模型：**无墙钟 + 可取消 + 进度可见**（clone 早已是这条路线：
`clone.rs` 的 "No timeout by design"）。

- 单一判据函数：`transport::git_command_timeout(args)` —— 上述四个操作返回 `None`，
  读类命令保留 `LOCAL_GIT_TIMEOUT`（一个卡住的轮询不应占死调用方）。
  前端对称：**所有**入口（Git 面板 `useGitActions` / `ProjectsPanel` / `CommitDialog`）
  对这四个操作一律**不包 `withTimeout`**（stage/discard 保留 30s），且统一经
  `runGitConsoleOp` 编排 —— 新增入口必须复用同一编排，否则会重新引入
  「正常慢被 30s 误判成失败、后端进程继续跑」。**护栏**：
  `check_long_git_op_wall_clock`（禁 `withTimeout(push|pull|fetch|commitFiles(…)`）。
- 无界期间的挂死防护不是调大上限，而是**取消通道**；SSH 交互式凭据/指纹提示仍会挂起
  （`BatchMode` 未设，与 VS Code 的 askpass 是已知差距）。
- `pull` 内嵌的 `merge --ff-only` 保留上界：纯本地毫秒级操作，不满足「没有上界」的判据。

**取消通道（Workspace单飞 + 目标限定）**：`AppStateWrapper.git_sync` 是 `GitSyncSlots`
注册表（`Mutex<HashMap<WorkspaceRef::key(), GitSyncEntry>>`，`GitSyncHandle` 是 watch 通道，
与 `CloneHandle` 同构）。**互斥粒度 = Workspace**（`WorkspaceRef::key()`）：同一单元
（同 HEAD/index/workdir）串行、主仓与各 linked worktree 并行 —— 与 §12 的身份模型一致
（`git status` 的写入单位是Workspace，不是 project，也不是全局进程）；跨仓不再误拒。
`cancel_git_sync(console_run_id)` 经 `GitSyncEntry::matches` 只取消 run id 匹配的运行
（前端 tab 是仓库级的，匹配把两个身份面钉在一起，避免陈旧 run id 误取消别的仓库）；
`None` = 取消全部。命令层唯一装配点 `begin_git_run(state, repo, app_handle, run_id)`
（占槽 + 产 hooks，任何返回路径由 RAII `GitSyncGuard` 释放）。transport 侧用 `select!` 让
「读流 + 等退出」与取消信号赛跑，取消时调用 kill 闭包 —— spawn 带 `kill_tree`，
pre-push 的 pnpm → vitest/cargo 整棵树一起摘除（实测：取消后无残留 `sleep` 进程）。
取消时等待 kill 确认有界（`executor::collect` 的 `KILL_GRACE = 5s`）：远端 kill 确认
（SSH 新通道）可能永不到达，无界等待会让该单元永久 busy、前端 tab 永远 `stopping`；超时仍
按 `Killed` 返回（信号已尽力发出，宁可放行槽也不永久卡死）。
同单元第二个写操作争 index 锁从「偶发失败」变为显式拒绝
（`AppError::Conflict`，文案 `common/git/transport/cancel.rs::BUSY_MESSAGE`，与前端
`GIT_BUSY_MESSAGE` 同文案且两端各有 pin 测试）。Console 侧：Cancel 按钮 →
`taskStore.cancelGitConsole(runId)`（状态置 `stopping` + 把 runId 透给后端）→ 后端被杀 →
命令 reject → `finalizeRun` 按 `[Stopped]` 收尾（不计失败、不弹错误 toast）。

**可见性**：四个操作把 stdout/stderr 按 UTF-8 边界成块（跨读边界的多字节字符在
`executor::collect_child_output_streaming` 补齐，不产生 `U+FFFD`）经
`git-operation-output` 事件推给 Console。**事件必须合流**：`drain_stream` 按
`FLUSH_BYTES`(16KB) / `FLUSH_INTERVAL`(50ms) 把高频小读攒成低频事件、EOF 强制冲刷尾巴 ——
macOS 上 Tauri 事件送达 = 每次 `evaluateJavaScript`，逐读块 `emit` 会把长操作输出风暴
放大成同类内存压力（对照终端合流泵）。红线 5：常量单源在 `git/events.rs`，前端常量在
`shared/events.ts`、payload 在 `shared/types/git.ts`；事件按 `consoleRunId` 落入
`taskStore.openGitConsole` 的仓库级 tab（一仓一 tab），app 级订阅 `useGitConsoleBridge`
保证面板关闭期间继续收流。hook 输出走 stderr —— 这是「推送成功却看不到任何输出」的根因
（成功路径旧实现丢弃 stderr）。前端编排单点在 `features/git/api/gitConsoleRun.ts`：
`runGitConsoleOp` 统一 begin → 成功/认证/失败收尾，并在**该仓 tab 已有 run 在飞
（`running` 或 `stopping`）时返回 `busy` 且不触碰 tab** —— 多个入口共用同一个仓库级 tab，
若不去重，第二个入口的失败收尾会把正在跑的第一个 run 误标 `failed`（旧 run 的 reject 回调
也会误伤被接管的新 tab）。

**DRY（同一生命周期只留一份）**：命令层的「占槽 + 产 hooks」收敛到 `begin_git_run`
（此前 7 处各写一段）；Local / WSL / SSH 的「spawn 包装器 → 流式采集 → 取消赛跑 →
错误映射」收敛到 `transport::run_spawn_streaming` + `finish_git_output`（此前三份复制）。
`GitTransport::run_git_opts_streaming` 的默认实现**只服务测试假实现**（静默退化为聚合调用、
忽略 hooks）；它是唯一生产实现 `ExecTarget` 必须覆写的方法 —— 与红线 3「默认体不得回落
同步核心」同理，默认体不得成为生产路径。

**退出收敛（子进程登记表）**：git 传输层用 `kill_tree` 自组 spawn，但 kill 动作只在**主动取消**时被
调用 —— 应用退出 / 运行时空停时 future 被丢弃、kill 不执行，整棵树（git → hook → pnpm →
vitest/cargo）会孤儿化。`common/executor` 的 `child_registry` 让 `run_spawn_streaming` 在子进程
**存活期**登记它的 `KillFn`（= `Arc<dyn Fn() -> KillFuture>`，**与取消共用同一个动作**；动作的
宿主/远端差异由 executor 在构造时按 `ExecTarget` 定下，传输层与登记表都不分支执行目标）。
`AppStateWrapper::shutdown_background_and_exit` 的 CleanupTask（`"git-children"`）在所有后台服务
关停前调 `kill_all_live()`，逐个同步驱动该动作（确认有界 5s）：

- **宿主本地（Local / WSL）** 的动作 = 本地进程组树杀（`platform::process_spawn::kill_process_tree`，
  红线 10 门面）；
- **远端（SSH）** 的动作 = 在**远端**新开一个通道执行 `kill -9 -<remote_pid>`。**绝不能本地按 pid 杀**
  —— 远端 pid 与本地 pid 取值区间无关联，按 pid 本地树杀会误杀本机无关进程。

已结束的项早已注销 ⇒ 降低 pid / 进程组复用误杀。「运行期 future 被 drop（非退出）自动树杀」不在范围
（无取消协议时该场景不可达）。

**测试**：`transport/tests.rs`（`git_command_timeout_leaves_long_ops_unbounded` +
流式交付与聚合逐字一致）、`transport/cancel.rs`（取消先于等待 / 唤醒等待者 /
`GitSyncEntry::matches` 只命中同关联标识 / `GitSyncSlots` 同单元互斥·异单元并行·守卫释放 /
busy → `AppError::Conflict`）、`executor/collect.rs`（取消杀进程闭包 + 返回 Killed /
kill 不收敛仍有界返回 / 合流：小读合流 / 宽限交付 / EOF 尾巴不丢）、`git/events.rs`（run id 校验 /
流标签 / 原样回传）、`operations/tests.rs`（`commit_files` 输出实时进 sink；
`push_cancel_aborts_pre_push_hook_and_returns_promptly` 端到端取消 + 树杀）、
前端 `gitConsoleRun.test.ts`（busy / stopping 不接管 / 取消返回 stopped /
认证收尾 / ok 透传 runId）、`taskStore.gitConsole.test.ts`（稳定去重 / 追加 / 失败态 /
取消置 stopping 且透传 runId）、`useGitActions.test.ts`（runId 透传、AuthRequired 收尾、
悬挂 200s 不判失败、取消后 [Stopped] 收尾且不弹错误 toast）。

## 14. 派生值新鲜度契约（依赖集合 ⊆ 监听集合）与 ahead/behind 单源

**第一性原理**：仓库是文件系统数据库，UI 里的一切都是「磁盘状态 → 派生值」的缓存。缓存新鲜度
是一条**集合包含**关系：

> `被监听/被触发重算的输入集合 ⊇ 该派生值依赖的输入集合`

落在监听集合之外的输入 = **无上界陈旧**（不是「慢」，是「永不自己更新」）。历史缺陷：Changes
面板的 ahead/behind 徽标依赖 `refs`（本地分支 ref + remote-tracking ref），而 git-meta watcher
只覆盖 `HEAD` / `index`、heartbeat 只重算 porcelain+branch —— 外部 `git push` 改写的
`.git/refs/remotes/**` 无人监听，徽标无界陈旧（2026-10-07 修复）。

**契约**：

1. **一个Workspace的展示态 = 一个派生值、一个生产者**（与 §12 同一前提）：
   `GitStatusSnapshot = f(HEAD, index, workdir, refs)`，其中 `entries/truncated/branch` 来自前三者，
   **`ahead` / `behind` 来自 refs**。四个输入都必须落在同一套监听里，产物必须随**同一个
   `version`** 经**同一条 `git-status-snapshot` 通道**投递。
2. **refs 监听范围**：git-meta watcher 除 `HEAD` / `index` 外，还要监听 **`refs/`（递归）** 与
   **`packed-refs`**（linked worktree 的 refs / packed-refs 位于 shared common gitdir，由
   `resolve_common_git_dir` 定位；`packed_refs` 的父目录需单独非递归监听）。外部 `git push`
   改写 loose ref（实测 `refs/remotes/origin/<branch>`）即被捕获。
3. **监听层只发信号，不携带事实**：refs 回调只 `ThrottleScheduler.send(())`，由 worker 的
   查询-比较闸门决定是否 emit；**不新增事件名**（红线 5）、不 emit、不形成「写 refs → 事件 →
   再写」自反馈。
4. **change gate 比较「即将 emit 的快照本身」，而非一组平行局部变量**：`GitStatusSnapshot`
   `derive(PartialEq)`，worker 先组装候选快照（`version` 归零 —— 注册表 `store_snapshot` 盖章，
   worker 私有 counter 已被覆盖），再以 `last_snapshot.as_ref() == Some(&candidate)` 判定。
   新增快照字段**自动纳入闸门**，不需要维护一组布尔合取 —— 历史写法
   `current == last_status && current_branch == last_branch && ahead == last_ahead && behind == last_behind`
   已退役：它要求每加一个派生字段都手动补进合取，漏一个就是「静默永不 emit」（本 bug 的形态）。
   折叠摘要（gate-only 探针，不进快照载荷）仍单独比较；未知一律放行（宁可多发，不可漏发）。
5. **计算语义**：`git rev-list --left-right --count @{upstream}...HEAD`，left=behind、right=ahead；
   无 upstream / detached / 命令失败 → `(0, 0)`（不是错误）。**解析的唯一实现**是
   `common/git/parsers/ahead_behind.rs::parse_ahead_behind` —— worker（同步 facade）与
   `operations::get_ahead_behind`（async transport）都委托它，禁止各自 `split('\t')`（两处实现 = 两处可漂移口径）。
   **禁止硬编码 `origin/`** —— 非 origin 远端会算错（唯一入口 `operations::get_ahead_behind`，
   仓库存在性校验交 `transport.is_git_repo`，**不得**用宿主 `assert_git_repo_async`
   （WSL/SSH 会误判非仓库并静默归零））。
   即使仓库存在 `origin/<branch>`，只要当前分支没配置 upstream（`@{upstream}` 解析失败），此处也
   一律报 `(0, 0)` / 命令错误，而**不再**退回按 `origin/<branch>` 计数 —— 这是更正确的语义。
6. **条目上限与快照承载是同一条不变量**：`MAX_STATUS_ENTRIES` 与 `truncated` 由
   `GitStatusSnapshot::enforce_entry_cap()` **单点施加**（worker 与 pull 生产者共用），
   禁止各自 `truncate`（重复实现即两处上限可漂移，且 pull 侧容易漏掉 `truncated`）。
   pull 生产者构造**完整快照**后交 `record_computed(snapshot)`（不再用
   `(repo, entries, branch, ahead, behind)` 的伸缩参数 —— 下一个派生面不必再改签名）。
7. **前端单通道消费**：`useGitStatusEventsSync` 在**快照被 version gate 接受后**才
   `setAheadBehind(workspace_key, {ahead, behind})`（被拒的陈旧快照不得覆盖徽标）；不得再有第二条
   pull 写入点。`useAheadBehindSync` 只作冷启动初始种子（快照到达前），语义与键（`WorkspaceKey`）与
   快照同形。

**Wrong**：

```rust
// 监听只有 HEAD/index；ahead/behind 靠独立 pull + 散落触发 —— 外部 push 永不触发
```

**Correct**：

```rust
// 组装候选快照 → 整值比较（新增字段自动入闸，无需维护布尔合取）
let mut candidate = GitStatusSnapshot::for_unit(&repo, 0);
// candidate.branch / entries / ahead / behind = ...
candidate.enforce_entry_cap();
let changed = last_snapshot.as_ref() != Some(&candidate) || collapsed_digest.is_unknown();
if changed {
    last_snapshot = Some(candidate.clone());
    on_change(candidate); // 注册表盖章 version
}
```

**测试**：`status_worker/worker.rs`（`ahead_behind_*` 三态 + **`worker_emits_new_snapshot_on_pure_ref_change`**
回归钉子 —— 撤掉 ahead/behind 参与比较即超时）、`parsers/ahead_behind.rs`（left/right→behind/ahead、
缺字段 / 非法 / 空白容错）、`git_meta/classify.rs`（`refs/heads|remotes/**`、`packed-refs` → `RefsChanged`；
`config`/`ORIG_HEAD` → `Nothing`）、`git_meta/tests/watcher.rs`（真实 FS 写 refs / common-gitdir
packed-refs 触发 `on_refs_changed`；common-dir watch 失败仍存活）、
`manager/lifecycle_tests.rs`（`external_ref_update_pushes_a_new_snapshot_without_manual_poke`：
watcher→scheduler→worker→snapshot 端到端，无手动 poke）、`git/services/status.rs`（远端 pull
生产者填 `ahead/behind`；`get_ahead_behind` 走 transport 校验而非宿主 fs）、前端
`useGitStatusEventsSync.test.ts`（快照写入徽标；**被拒快照不得覆盖**）。

## 相关文件

- `src-tauri/src/common/git/workspace_ref.rs` — Workspace身份（`WorkspaceRef` / `Checkout` / key 契约）
- `src-tauri/src/common/git/checkout_path.rs` — 路径身份唯一入口（identity / exec 双渲染 + I1/I2/I3）
- `src-tauri/src/platform/path_identity/` — 身份字母表的平台渲染规则（红线 10）
- `src-tauri/src/common/git/path_guard.rs` — 工作树路径与仓库内相对路径的**校验**（归一不在此）
- `src-tauri/src/common/git/refs.rs` — refs 分类纯函数
- `src-tauri/src/common/git/parsers/` — `status` / `numstat` / `commit` / `quoting`（C 转义唯一解码点）
- `src-tauri/src/common/git/cache/` — `get_cached_worktree_diff` / `FileFingerprint` / LRU diff 缓存
- `src-tauri/src/common/git/status_worker/` — status 快照唯一计算路径（含折叠 untracked 目录内容摘要 `collapsed_probe.rs`）
- `src-tauri/src/git/services/status.rs` — 单元 status 读接口与挂载编排（`read_workspace_status` / `activate` / `wait_status_fresh`）
- `src-tauri/src/common/file/watcher/manager/` — 按单元挂载的资源注册表（`watchers` / `snapshots` 主键 = `WorkspaceRef::key()`）
- `src-tauri/src/common/file/watcher/git_meta/` — 单元 git 元数据监听（HEAD / index / `refs/**` / `packed-refs`）
- `src-tauri/src/common/git/operations/` + `local/` — `get_commit_log` / `get_stash_list` / `get_stash_files` / `get_file_diff` / `status_porcelain`
- `src-tauri/src/git/commands/` + `src-tauri/src/lib.rs` — 命令透传与注册
- `src-tauri/src/git/events.rs` + `src/shared/events.ts` / `src/shared/types/git.ts` — 长操作输出事件的常量与 payload 双端单一源（红线 5）
- `src/features/git/hooks/useGitConsoleBridge.ts` — 事件 → Console tab 的 app 级路由（面板关闭也收流）
- `src/features/git/components/diff/useDiffData.ts` — 前端无状态 diff 消费者（git-status-diff / file-changed / 手动刷新驱动重拉）