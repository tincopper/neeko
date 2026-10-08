# Git changes 实时化：refs 监听 + ahead/behind 并入权威快照

## Goal

外部 git 操作（终端 / agent / 其它工具执行 `git push`、`fetch`、`pull`、`commit`、`reset` 等）
之后，Changes 面板的 **ahead/behind 徽标**与**文件列表/数量**能自动、及时地反映真实状态，
不再需要用户手动刷新或等待 30s 心跳。

用户价值：Git 面板成为「看即真相」的视图，与终端里刚执行的 git 操作保持一致。

## Background

`git status = f(HEAD, index, workdir)`，而 UI 展示的「同步态」还依赖**第四类输入**：
`本地分支 ref` 与 `remote-tracking ref`（ahead/behind 由它们决定）。

现状的依赖集合与监听集合不一致：

- git-meta watcher 只识别 `HEAD` / `index`（`git_meta/classify.rs`），且对 `git_dir`
  做 **非递归** 监听（`git_meta/watcher.rs`）→ `.git/refs/remotes/**` 根本不在范围内，
  `packed-refs` 被监听到但分类为 `Nothing`。
- `GitStatusWorker` 只重算 porcelain + branch（`status_worker/worker.rs`），**不含**
  ahead/behind；`GitStatusSnapshot` 没有 ahead/behind 字段（`status_worker/writer.rs`）。
- ahead/behind 走独立 pull 命令 `get_ahead_behind`（`git/commands/history.rs`），
  触发点散落在应用内 git 操作、切项目/切单元、分支名变化三处；外部 push 全都不触发。
- 心跳（`manager/core.rs`，每 30s）只调 `worker.check()`，同样不含 ahead/behind。
- 窗口 focus（`useGitStatusEventsSync.ts`）只刷新 `refreshRepoStatus`，不刷新 branch info。

结果：外部 `git push` 后，`↑N` 徽标在无其它触发时**无界陈旧**（不是慢，是永不更新）。

实证：`git push` 会改写 `.git/refs/remotes/origin/<branch>`（loose ref，已在临时裸仓验证），
因此对该目录的递归监听可捕获外部 push。

## Requirements

### R1 依赖集合 = 监听集合（正确性）

- R1.1 监听 `.git/refs/**`（递归）与 `.git/packed-refs`，任一变化 → 触发该单元一次重算。
- R1.2 重算必须覆盖 ahead/behind：`@{upstream}...HEAD` 变化能产生新的权威快照。

### R2 单生产者（高内聚）

- R2.1 `GitStatusSnapshot` 携带 `ahead` / `behind`，由 **同一个生产者**（挂载单元的 worker
  / 远端未挂载单元的 pull 现算）在**同一次重算、同一个 version** 内产出。
- R2.2 前端只消费 `git-status-snapshot` 一条通道写入 ahead/behind；删除散落的
  `getAheadBehind` 触发（`refreshUnitBranchInfo` 内的调用可退役）。
- R2.3 不新增事件名（红线 5）；复用现有 `WatcherEventSink` / `RepoRef::key()` / version gate。

### R3 行为兼容

- R3.1 无 upstream / detached HEAD / 非 git 单元：`ahead = behind = 0`，不报错。
- R3.2 远端（WSL / SSH）pull 生产者同样填 `ahead/behind`，不得把徽标打回 0。
- R3.3 现有 `HEAD` / `index` 的触发与 `git-changed` fallback 语义不变。
- R3.4 序列化向后兼容：新字段 `#[serde(default)]`。

### R4 测试

- R4.1 worker：upstream 推进/落后时 `ahead/behind` 正确；**纯 ref 变化也必须 emit**（回归钉子）。
- R4.2 `classify`：`refs/heads/**`、`refs/remotes/**`、`packed-refs` → `RefsChanged`；
  `config` / `ORIG_HEAD` / 无关路径 → `Nothing`。
- R4.3 watcher 集成：真实 FS 写 `.git/refs/heads/<b>` 触发 `on_refs_changed`。
- R4.4 前端：收到含 ahead/behind 的快照后 `gitStore.aheadBehind[repoKey]` 被写入。

## Acceptance Criteria

- [ ] AC1 `pnpm test:rust` 全绿（含新增 worker / classify / watcher 用例）。
- [ ] AC2 `pnpm test:fe` 全绿（含快照→ahead/behind 消费用例）。
- [ ] AC3 `pnpm lint`（eslint + tsc + fmt + clippy + 全部护栏）通过。
- [ ] AC4 行为验证：在临时仓库中，应用外执行 `git commit`（ahead+1）与 `git push`（ahead→0）后，
      面板在无手动刷新情况下自动更新（由 watcher→worker→snapshot 链路驱动）。
- [ ] AC5 `GitStatusSnapshot` 前后端字段同步（`writer.rs` ↔ `shared/types/git.ts`）。

## Out of Scope

- 分支清单 / worktree 清单（`git_info.branches` / `worktrees`）的实时化 —— 那是 per-project
  的 ref 集合，另开任务。
- `git status` 本身在超大仓库的耗时优化。
- 远端（WSL/SSH）无 push 生产者时的实时性（仍为「显示即拉」）。
- 前端渲染性能。

## Open Questions

- 无。设计与实施计划见 `design.md` / `implement.md`。
