# 阻塞 fs 收口：仓库打开/校验清扫 + 命令层护栏（红线 3）

## Goal

neeko-check 两轮审查的遗留，合成一个任务：

- **F1（P2，既有债务）**：本仓把「路径解析」的阻塞 fs 收进阻塞池后，**同一根因的另一类**仍在
  async 命令路径上 —— `git2::Repository::open`（`transport.open_repo`）与 `.git` 探测
  （`local::assert_git_repo` / `is_git_repo_local`）。它们与 F1 同族：命令入口、网络盘上可秒级阻塞、
  阻塞期间 PTY 输出 / watcher 事件 / IPC 共用同一 worker。
- **F4（P3）**：把「命令层只许走异步入口」从文档约定变成**可执行判据**（静态护栏），
  否则本次清扫结果无法防护回潮 —— 下一次有人写 `transport.open_repo(...)` 照样能过门禁。

## Requirements

**领域层（成对提供：同步核心 + 异步入口）**

- `GitTransport::open_repo_async(&self, path) -> Option<git2::Repository>`：**无默认实现**
  （默认调用同步核心 = 静默退化成阻塞，正是要消灭的形态）⇒ 编译器强制每个 impl 表态。
  `ExecTarget` 的 Local 分支在 `spawn_blocking` 内调同步核心；WSL / SSH 返回 `None`（不碰本地 fs）。
- `GitTransport::is_git_repo`（已是 `async fn`）：Local 分支**内部**包 `spawn_blocking` ——
  异步 trait 方法里的同步实现是「假异步」，调用方以为不阻塞。
- `local::assert_git_repo_async(&str)`：语义与同步核心逐字相同，只是发生在阻塞池内。
- 同步核心（`open_repo` / `assert_git_repo` / `is_git_repo_local`）保留给「同步上下文 / 已在
  阻塞池内」的调用方，文档标注调用纪律。

**调用点（全部改走异步入口，语义零变化）**

- `common/git/operations/info.rs:115,116,144,145`（`get_git_info` / `get_git_branch_info`）
- `common/git/operations/log.rs:173`（`get_ahead_behind`）
- `common/git/operations/diff.rs:233,255`（`get_changed_files_diff_stats` / `get_file_diff`）
- 测试假实现（`operations/tests.rs` 三处 `impl GitTransport`）显式补 `open_repo_async`（返回 `None`，
  与它们的 `open_repo` 一致），否则 git2 分支在测试里会静默退化 ⇒ 覆盖变弱。

**护栏（F4）**

- 新增 `tools/guards/checks/check_blocking_fs_in_commands.py`，扫「命令层 + async operations 层」，
  禁止直连同步原语：`UnitPath::resolve(` / `RepoRef::resolve(` / `assert_git_repo(` / `.open_repo(` /
  `…git::(local::)?is_git_repo(` / `use` 导入后的裸名 `is_git_repo(`，要求改用对应异步入口
  （报错信息里给出替代写法）。
- 判据只收「有成对异步替代」的原语；**不收** `std::fs::*` —— 闭包内的合法性（`spawn_blocking(move || std::fs::…)`）
  无法静态判定，硬收会制造噪声，其纪律由 spec Scenario 与审查兜底（写在护栏文档里）。
- 池豁免必须同时认 `spawn_blocking` / `run_blocking` / `run_blocking_result`（后者是命令层主力形态，
  漏一个就是把 79 处合法调用集体误报）；配对必须在**抹平注释与字面量后的等长文本**上做
  （否则 `// }` 会截断 async 体、闭包里的 `'('` 会破坏池配平）。
- 配套单测（框架硬要求）：正例 / 反例 / `#[cfg(test)]` 块豁免 / scope 外文件 / 判据健壮性四形。

**测试（新增生产分支必须有直测）**

- `transport::tests::test_local_open_repo_async_matches_sync_core`：`ExecTarget::Local` 的 git2 分支
  必须真的打开仓库；三个测试假实现全返回 `None`，无此直测则该分支坏了也全绿。
- `local::diff::tests::assert_git_repo_async_matches_sync_core`：异步入口 ≡ 同步核心，领域错误
  不被 `JoinError` 文案覆盖。

**文档与台账（第三轮 neeko-check 复核同轮修复）**

- spec Contracts 10 收三个池包装名 + 抹平纪律；Tests Required 收两条新测试；`Pillar 7` 换算为「红线 3」。
- 台账：本任务补 `task.py start`（current 指针此前为空）、PRD 验收项逐条勾选并附证据。

**文档**

- `.trellis/spec/backend/concurrency-guidelines.md` 的 Scenario 扩 Scope（仓库打开/校验类）与
  Contracts（成对原语、无默认实现、护栏 id）。

## Acceptance Criteria

- [x] 命令层与 `common/git/operations/**` 无同步原语直连（护栏 44 个文件 / 0 处命中 + 2026-10-02 复核
      `pnpm guards run --stage local` → `scanned=44` `0 处阻塞池外直连`）
- [x] `is_git_repo` 的 Local 分支在阻塞池内；`open_repo_async` 无默认实现
      （`transport/mod.rs:197` 只有声明无默认体；三条测试假实现被编译器逼着表态）
- [x] 行为零变化：`cargo test --lib` 1386 → 1388，**增量恰为新增的 2 条直测**，无既有用例改写；
      `pnpm test:fe` 500 files / 4483 passed（未触及前端）
- [x] 新护栏 + 配套单测通过；`pnpm guards list` 能看到它；CI `--stage ci` 覆盖
      （`check_blocking_fs_in_commands` local/ci/commit 三阶段，框架自检 206 条）
- [x] `pnpm lint` / `pnpm check` 全绿（2026-10-02：`EXIT=0`；唯一输出为 eslint 的
      `VirtualList.tsx` 既有 warning，0 error）

## Non-goals

- **`ProjectManager` 与同步命令**（`project/manager.rs:53,113,198` 的 `git::is_git_repo` /
  `git::get_git_info`；`project/commands.rs::add_project` / `refresh_git_info` 是 `pub fn` 命令）：
  这属「**同步命令阻塞主线程**」这一**不同类** —— 修它需要 `ProjectManager` 异步化（连带持久化与
  若干命令签名），范围与风险都另算。本次只记录证据，建议独立任务。
- **同类未收口（红线 3，async 路径上的同步 fs，本次未覆盖，须独立任务跟进）**：
  `search/commands.rs:62`（`search_run` 内 `Path::canonicalize`）、
  `agent/commands.rs:204,227`（`import_agent_icon` 内 `source.exists()` / `metadata()`，同函数已用
  `tokio::fs::*`）、`dap/adapter/java/protocol.rs:202,211,230`（`resolve_spawn` / `is_available` 内
  `exists()`）。它们与本次同根因，且都不在护栏判据集内（`std::fs::*` / `.exists()` 刻意不收，
  `dap/**` 不在扫描集）—— 故「清扫完成」不得被读作「同类已清零」。
- 不改 `assert_git_repo` 的调用条件与顺序（`get_git_info` 里它是**无条件**调用，语义原样保留；
  「远程 target 也跑本地探测」这一现象不在本任务讨论范围）。
- 不引入超时 / 取消语义（`spawn_blocking` 不可取消，既有语义）。
