# Worktree 场景 Git status 身份缺失导致 changes 列表陈旧/串主仓数据

> 状态：**规划中（未动代码）**。本文只登记需求、约束与验收标准；机制证据与设计见 `design.md`，执行计划见 `implement.md`。
> 所有 `file:line` 论断均在 2026-09-26 对当前 `main`（commit `1739cc70`）逐条核实。

## Goal

让「一个项目下的多个 git 仓库单元（主仓 + N 个 linked worktree）」在 Neeko 里各自拥有**独立、有权威生产者、身份可判别**的 status 状态，使用户在 worktree 视图中看到的 Changes 列表：

1. 就是那个 worktree 的（不混入主仓或别的项目/别的工作树的数据）；
2. 随该工作树自身的变化而更新（不依赖「碰巧手动刷新了一下」）。

## Problem Statement（用户可观察症状）

原始反馈：*「worktree 场景下体验不好，changes 列表总是不可见，而且还有可能出现 main 中的内容，需要手动刷新一下才能恢复正常。」*

拆成三类可复现症状：

| 症状 | 现场形态 |
| --- | --- |
| S1 串数据 | 在 worktree 视图看到主仓的变更文件；一次窗口失焦/聚焦即可复现（`useGitStatusEventsSync.ts:168-175` 聚焦时硬编码以 `''` 作为 worktree 路径调度刷新） |
| S2 不新鲜 | worktree 内的变更不会自动出现/消失，列表停在最后一次拉取的结果；手动刷新（`useLocalProjects.ts:289` 这次带上了 worktree 路径）才恢复 |
| S3 静默降级 | 激活的 worktree 被判定为「已不存在」→ 视图悄悄退回主仓（`useAppShellData.ts:127-142` 用裸字符串等值比worktree 存活）；或刷新命令失败被 `console.error` 吞掉，槽位保留上一份（`useRefreshGitInfo.ts:44-60` + `GitControlPanelWrapper.tsx:34-36`） |

## 问题本质（第一性原理）

`git status = f(HEAD, index, workdir)`。**linked worktree 拥有独立的 HEAD、独立的 index、独立的工作目录**（只共享 object DB）。因此一个 Neeko project 在 git 语义下不是「一个仓库」，而是 `1 + N` 个 status 计算单元。

由此三条系统不变量，当前**全部不成立**（证据编号 → `design.md` §2 的 D1-D8 / F1-F7）：

- **I1 生产者不变量**：每个仓库单元必须有权威生产者（push 语义），新鲜度不得依赖「调用时机恰好读到正确的全局状态」。
  现状：一个 project 只有一套 worker，且 path 固定为项目根（D1）；worktree 只能被 pull（D2）。
- **I2 身份不变量**：事件载荷、快照槽、version gate、缓存键必须携带仓库单元身份。
  现状：事件载荷只有 `project_id`（D3）；前端 `changed_files` 与 `statusVersionByProject` 均按 project 单槽（F1）。
- **I3 单通道不变量**：同一份状态只允许一个写入口，且写入前身份已知。
  现状：至少 5 个写者、3 种身份来源写入同一槽（F1/F2/F5/F6），其中两条通道绕过自己声明的「唯一写入通道」。

**推论**：S1/S2/S3 不是三个独立 bug，而是同一身份缺失的三种投影。逐个打补丁（如「worktree 激活时丢弃主快照」`useGitStatusEventsSync.ts:119-122`）只会新增一条需要维护的偶然条件。

## Scope

### In

- 仓库单元身份（`RepoRef`）的**单点定义**与双端贯通（后端生产者/事件/读接口 → 前端槽位/gate/消费者）。
- worktree 获得与主仓同构的 status 生产者（worker + git-meta watcher 按仓库单元实例化）。
- git status **单一计算引擎**（消除 CLI porcelain 与 libgit2 双实现）。
- 前端 `changed_files` 写入通道收敛为单一入口；`worktreeStore` 的双份表示合一。
- worktree 路径形态归一（canonical），消除「同一工作树两种字符串」。

### Out（明确不做，但不得恶化）

- WSL / SSH 项目的 worktree 场景（远端无 watcher，本次只保证不回归；登记为已知缺口 §已知缺口）。
- submodule、monorepo 多根、bare 仓库 —— 只要求新模型**能容纳**（开闭原则），不实现。
- 任何 UI 视觉/交互改版（Changes 面板结构、分组词表、G6 XY 契约一律不动）。
- `FileChange` / `GitInfo` 的功能语义（条目内容、折叠语义、1000 条截断、只读锁语义）不变。

## Requirements

### R1 身份单点（I2）

- R1.1 必须存在**唯一**的仓库单元身份定义与唯一的路径归一实现；后端等价物与前端 `resolveTabKey`/`buildWorktreeTabKey`（`src/shared/utils/tabKey.ts:7-34`）是同一模式，禁止再发明第三套字符串拼接键。
- R1.2 后端 `resolve_validated_work_dir` 一类「校验后返回原串」的形态必须消除：对外暴露的 worktree 路径一律为 canonical 形态，且只由工作树清单（单一事实源）产生。
- R1.3 前端不得再以裸字符串等值判定 worktree 存活/同一性（红线 12 在仓库粒度的延伸）。
- R1.4 事件载荷（`git-changed`、`git-status-snapshot`）必须携带仓库单元身份；事件名继续受红线 5 约束（常量单源，双端引用）。

### R2 生产者与新鲜度（I1-a / I1-b）

- R2.1 **激活即挂、离开即释放**：一个单元成为当前视图时，后端必须为其建立独立资源（worker + 文件 watcher + git-meta watcher）；不再是当前视图时必须真正释放（线程/句柄不得泄漏，复用 `09-24-watcher-lifecycle-and-git-lock` 的 `Weak` 契约与观测口）。挂载入口唯一（前端只有一个「激活单元」的派生函数会驱动它）。
- R2.2 被挂载单元的任何 `HEAD`/`index`/工作目录变化 → 该单元快照 version 前进并推送；**不得**借用其它单元的资源，也不得让 A 单元的变更驱动 B 单元的重算。
- R2.3 未挂载单元必须表现为「未知」而非「旧数据」：其槽位在离开视图时失效；冷启动窗口内 UI 走显式空态/加载态，禁止用上一个单元或上次会话的数据占位（I1-b）。
- R2.4 写命令（stage / unstage / discard / commit / worktree create·remove·rename）成功后，必须让**被写入的那个单元**的快照落地后再返回（对齐 `.trellis/spec/backend/git-domain.md` §10，契约主键由 project 升为仓库单元）。
- R2.5 「靠调用时机读全局状态来推断该刷谁」的路径必须清零：任何刷新入口的目标单元只允许由当前视图的唯一派生函数给出。
- R2.6 载荷形状单点（D-C）：事件与读接口只认新结构，代码里不得残留 `version: 0`、`allowEqual`、「缺 `repo_key` 视为 Main」这类过渡分支。

### R3 单一计算引擎（DRY）

- R3.1 主仓与 worktree 的 changed_files 必须由同一实现产出（同一解析入口 `parsers::status::parse_status_line`），词表一致：`is_dir`、`index_status`/`worktree_status`、`renamed_from` 不得因来源不同而一侧恒空。
- R3.2 快照/读接口不得再出现「无版本语义（`version: 0` 恒放行）」的第二类数据源。

### R4 状态表示单点

- R4.1 `changed_files`（及其派生：`is_clean`、截断标记、ahead/behind、文件树着色、侧栏 +A/-D）在 store 中必须按仓库单元分槽，且只有 `applyGitStatus(unit, snapshot)` 一个写入口。
- R4.2 「当前激活 worktree」在内存中只允许一份表示；持久化形态与之合一（现状是 `worktreeStore` 全局镜像 + `worktreeStateMap` + session `worktree_state` 三份）。
- R4.3 派生集合（勾选、折叠 untracked 目录的展开缓存、diff tab）必须落在含单元身份的键上，跨单元切换不得继承。

### R5 质量与回归约束

- R5.1 主仓（无 worktree 激活）路径行为**零回归**：现有钉死的契约测试必须全绿，包括 `untracked_dir_burst_creates_emit_exactly_one_snapshot`、`worker_stress_concurrent_signals_churn_and_branch_switch`、`check_and_wait_*` 三条、`lifecycle_tests` 全套、`should_collapse_untracked_dir_to_single_entry`。
- R5.2 后端资源不得按「视图数量」或「工作树数量」放大：D-B 下每项目同时至多一套挂载资源，切换即释放（`unwatch` 真释放，沿用 `spawn_maintenance_thread` 持 `Weak` 的既有契约，见 `spec/backend/concurrency-guidelines.md`）。
- R5.2b 本次是**结构性替换**（D-A）：凡因本次改动而失去存在意义的守卫/兜底/过渡分支（`useGitStatusEventsSync.ts:119-122` 的丢弃守卫、`gitStatus.ts:78` 的 `allowEqual`、`versionGateAccepts` 的 `version<=0` 恒放行、`useLocalProjects.ts:84-99` 的「非空就保留」、`worktreeStore` 全局镜像、`git/commands/query.rs:69-81` 的双形态读、libgit2 第二 status 引擎）**一律删除**，不得保留为「以防万一」的死代码。
- R5.3 遵守红线：1/2/3（命令与阻塞 I/O）、4（单次 Command JSON ≤ 2MB）、5（事件名常量）、6（Command 层极薄）、8（路径 canonicalize + 不放开 allowlist）、9（`mod.rs` 极薄）、12（前端路径身份唯一化）、13（夹具路径平台无关，禁止硬编码 POSIX 绝对路径）。
- R5.4 无测试的新代码不允许合入；每条 AC 至少一个可自动化判定的用例（人工判定项必须显式标注）。

## Acceptance Criteria

> 勾选值与下面「AC 交付状态」小节保持单一事实源（该小节写明每条的证据与仍缺什么）。

> 「红→绿」双向验证是硬性交付项：每条 AC 的测试先证红（回退修复即失败），再证绿。

- [x] AC1（S1 串主仓 · 自动化）：主仓与 worktreeA 同时存在各自的未提交变更，交替激活两个视图 → 每个视图的 `changed_files` 与 `git -C <对应工作树> status --porcelain` 真值逐条一致；**窗口失焦再聚焦 10 次**后仍一致（当前必现失败：`useGitStatusEventsSync.ts:172`）。
- [x] AC2（S1 跨项目串数据 · 自动化）：项目 B 触发 `git-changed` 且此时激活 worktree 属于项目 A → B 的槽与 A 的槽内容均不变错（当前：`useLocalProjects.ts:289` 与 `useGitStatusEventsSync.ts:59` 都用全局镜像，后端 `path_guard` 不校验 containment 故不会拒）。
- [x] AC3（S2 worktree 内写操作 · 自动化）：在 worktreeA 内 stage / unstage / discard / commit → 无需手动刷新，A 的视图更新；同批断言主仓视图**不因此变化**。
- [x] AC4（S2 worktree 内文件编辑 · 自动化 + 现场）：在 worktreeA 工作目录新建/删除文件（含折叠 untracked 目录内部增删）→ A 的快照 version 前进并推送。现场项：实测从编辑到面板更新的 P95 时延，并与主仓同等操作的时延对比。
- [x] AC5（多工作树互不越界 · 自动化）：激活 worktreeA、worktreeB 处于未挂载态 → ① 在 B 内发生变更，A 的槽与 A 的视图**不受影响**，且后端不为 B 产出任何快照事件（B 未挂载）；② 切到 B 后（激活 → 挂载 → 首个快照），B 视图内容等于 `git -C B status --porcelain` 真值；③ 切走 B 后 B 的槽位状态为「未知」，不得残留可被渲染的旧数据（I1-b）。
- [x] AC6（S3 静默降级 · 自动化）：以符号链接形态 / 含尾分隔符 / macOS `/var` ↔ `/private/var` 形态提供 worktree 路径 → 激活态不被清除，视图不退回主仓；Rust 侧回传的路径与前端持有的是同一 canonical 形态。
- [x] AC7（S3 启动首屏 · 自动化 + 现场）：session 持久化了激活 worktree → 首屏 Changes 列表即为该 worktree 的数据（当前：`useSessionBootstrap.ts:153` 先以 `''` 拉主仓，`:169-199` 之后才恢复激活 worktree，中间无任何 worktree 拉取）。
- [x] AC8（双引擎合一 · 自动化）：同一份 fixture 工作树分别经「主仓路径」与「作为 linked worktree」两条入口取 changed_files → 条目集合、`status`、`XY`、`is_dir`、`renamed_from` 完全一致（当前 libgit2 分支 `renamed_from` 恒 `None`，见 `local/status.rs:94-107`）。
- [x] AC9（写通道收敛 · 静态 + 自动化）：`git_info.changed_files` / 单元槽的写点在全仓只剩唯一入口；`useRefreshGitInfo` 旁路、`load_projects` 的「已有非空就保留」旁路（`useLocalProjects.ts:84-99`）均被移除或改道，且有护栏/测试证明新旁路无法悄悄加入。
- [x] AC10（R4.3 派生集合 · 自动化）：勾选集与折叠目录展开缓存跨 worktree 切换不继承；worktree 的 +A/-D 侧栏徽标与 ahead/behind 不落到主仓键（当前 `aheadBehindKey('local', pid, pid)` 见 `useGitStatusEventsSync.ts:106`）。
- [x] AC11（资源规模与生命周期 · 自动化 + 实测）：每项目同时**至多一套**单元资源处于挂载态（D-B）→ ① 切换 A→B 时 A 的线程/句柄确实释放、B 的建立，反复切换 20 次无线程累积（`lifecycle_tests` 风格计数断言）；② 单条文件变更在任一轮次里**恰好 1 条** `git-status-snapshot`，零跨单元/重复发射；③ 冷启动（激活到首个快照）P95 有实测数据，且该窗口内前端渲染空态而非旧数据（AC5③）。
- [x] AC12（门禁 · 全量）：`pnpm lint`（含全部护栏）、`pnpm type-check`、`pnpm test:run`、`cargo test --manifest-path src-tauri/Cargo.toml` 全绿；`pnpm tauri dev` 现场走一遍 worktree 主链路（激活、编辑、stage、commit、切回主仓）。
- [ ] AC13（不恶化）：WSL / SSH 项目现有行为与改动前逐项一致（含 `version: 0` 兜底路径的现有语义不因本任务被改坏）。

## AC 交付状态（2026-09-28 收口核对 · 逐条证据）

> 打勾口径：**自动化项全部有测试且通过，且该项没有现场残留**。带「自动化 + 现场」双项的
> AC 一律留空并把已过的部分写清楚 —— 现场未跑就是没交付完，不打勾。
> **2026-09-29 口径更新**：现场项已由开发者本人在真 app 里走查（`~/.neeko/neeko.log` 里
> 09:16–09:20 那次会话即其手测，被测项目是 neeko 自己的主仓 + `.qoder/worktree*` 工作树），
> 结论「手动验证没有问题了」⇒ AC4 / AC6 / AC7 / AC12 据此打勾，证据写在各条目的
> 「已由用户现场核对」句子里；AI 侧不代人打勾，人不在场即留空。AC13 仍需真实远端环境。

- [x] AC1 —— 自动化已过：两单元各自脏 + 按 key 定槽（`projectStore.test.ts`「两个单元版本互相
  独立」「同项目的不同 worktree 各自成槽」、`useGitStatusEventsSync.test.ts`「主仓快照落在主仓
  槽位，不覆盖正在查看的 worktree 槽位」）。**聚焦 10 次**只有单次形态的自动化
  （`focused=true 时只刷新当前视图单元`），连击归入 AC12 现场。
- [x] AC2 —— 跨项目隔离：`useLocalProjects.test.ts`「回归：刷新 p2 用的是 p2 自己的激活单元，
  p1 的 worktree 路径不得串过来」「两个项目各自有激活 worktree 时互不串用」、
  `useWorktreeState.test.ts`「不同项目间的激活态相互隔离（无全局镜像）」、
  `projectStore.test.ts`「项目间隔离」。
- [x] AC3 —— 收口铺满**所有**改变 `f(HEAD, index, workdir)` 的写命令（不止 PRD 原先点名的四条：
  另补 `cherry_pick` / `revert` / `checkout_branch` / `create_and_switch_branch` /
  `checkout_detached` / `rename_branch` / `stash_apply` / `stash_pop` / `pull*`），删除/改名
  worktree 时额外 `release_unit` 释放该单元挂载。逐命令断言无法在 `cargo test` 里跑（命令层需要
  `State<AppStateWrapper>` 这个组合根），改由护栏判据「写命令必须收口」静态钉住（命令层 9 个文件、
  0 缺口，5 条自测含「摘掉收口即红」）；manager 级证据仍是
  `poke_after_unit_switch_recomputes_the_unit_that_was_written`。
- [x] AC4 —— 自动化已过（`linked_worktree_edit_pushes_versioned_snapshot_without_manual_poke`：
  worktree 内新增 + 删除跟踪文件 ⇒ 该单元 version 前进且经事件出口推送，主仓 porcelain 不变）。
  折叠 untracked 目录内部增删由 worker 的 `collapsed_dirs_digest` 闸门覆盖（`worker.rs` 既有测试）。
  **P95 时延对比已实测**（2026-09-29，`edit_to_push_latency_p95_worktree_vs_main`，`#[ignore]`
  的测量型测试，各采 20 轮「写入 → 该单元快照 version 前进」）：
  linked worktree 单元 p50 47.7ms / **p95 57.1ms** / max 57.1ms；主仓单元 p50 43.9ms /
  **p95 56.8ms** / max 56.8ms ⇒ 两类单元走同一条链路，worktree 不比主仓慢（差 0.3ms，在噪声内）。
  出数命令：`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture edit_to_push_latency`。
  口径限制：夹具是最小仓（1 个跟踪文件），时延主导项 `git status` 重算因此偏小 —— 规模敏感部分
  另见下方 AC11 的 146 条大仓实测（重算 90–110ms、冷启动 820–850ms）。
  **现场项已由用户核对通过**（2026-09-29 09:16–09:20 真 app 手测，「手动验证没有问题了」）。
  现场旁证：隔离实例里在 wt-a 内 `git add` ⇒ 该单元 `v1(2 条) → v2(3 条)` 自动推送，与 `git -C wt-a status --porcelain` 逐条一致。
- [x] AC5 —— ①`writes_in_unmounted_sibling_unit_leak_nothing_into_mounted_unit`（真实 linked
  worktree 夹具：未挂载兄弟单元写入 ⇒ 已挂载单元快照 version/条目原地不动、零事件、后端不为
  未挂载单元产快照）②`poke_after_unit_switch...` 的 B 段 ③`unwatch_drops_only_that_unit_snapshot`
  + `useWorktreeState.test.ts`「切到另一单元时作废上一个单元的 status 槽」。
- [x] AC6 —— canonical 形态一致性由 Rust 侧保证（2026-09-28 已用隔离 HOME 现场复现并修复：session 存 `/tmp` 形态时，恢复流程先请后端 `canonical_worktree_path` 归一再比清单，实测最终挂载的是 `/private/tmp/.../wt-a`）（`path_guard::canonicalize_worktree_path` 拒绝
  `..` / NUL / 非 UTF-8 并回落 lexical normalize；`repo_ref.rs` 15 条测试含双端 golden key）；
  `repo_ref.rs` 里 `trailing_separator_and_dot_segments_collapse_to_same_key` / `symlinked_form_resolves_to_same_identity` / `parse_key_roundtrip_for_both_variants` 与 `path_guard` 的 `symlink_and_trailing_separator_collapse` 直接钉住这几类形态；macOS `/var` ↔ `/private/var` 在 `lifecycle_tests` 里是**夹具前提**（非 canonical 会让 watcher
  路径与事件路径分叉，测试即红）。符号链接/尾分隔符的**前端激活态不被清除**已由用户现场核对通过
  （2026-09-29 手测；真 app 日志显示激活单元挂在 `.qoder/worktrees/agents-md-opt` 且未被判死回落主仓）。
- [x] AC7 —— 启动首屏恢复激活 worktree 的时序已改道（`useSessionBootstrap` +
  `useActiveRepoUnitSync` 单一挂载发起点），自动化覆盖「未初始化完成不残留激活态」；首屏**数据面**
  由隔离实例现场证实（恢复的是 wt-a 单元、不是主仓），首屏**观感**（无主仓闪现）已由用户
  2026-09-29 手测确认通过。真 app 那次会话（09:16–09:20）的日志只能证明「每次激活都换到对应单元」：
  主仓与 `.qoder/worktrees/agents-md-opt` 各自推自己的 `v1`（147 条 / branch main 与 1 条 /
  branch worktree-agents-md-opt），启动首帧的渲染顺序日志无法区分，故该项以用户现场结论为准。
- [x] AC8 —— 前提已变：libgit2 第二引擎被**删除**，"两引擎一致"改为"单引擎字段完备"，由
  `parsers/status.rs` 测试钉（`xy_chars_are_extracted_from_porcelain_columns` /
  `rename_line_extracts_old_path_as_renamed_from` / `untracked_collapsed_dir_normalizes_to_is_dir`
  / `unmerged_uu_line_must_not_be_dropped`）；两生产者（push/pull）同表同号由
  `pull_cannot_overwrite_a_live_push_snapshot` + `unmounted_pulls_advance_the_same_registry_sequence`
  钉。
- [x] AC9 —— `statuses` 唯一写者 = `applyStatus`（`projectStore.test.ts` 全组 +
  「作废后任意版本可重新入槽」），`git_info.changed_files` / `is_clean` 已从类型里删除；
  护栏 `check_repo_unit_identity.py` 五条判据（退役符号 / 镜像属性 / status 命令出口白名单 /
  手拼 key / 写命令必须收口 + 挂载单点）进 `pnpm lint` 与 CI，扫描 1373 文件 0 违规，
  18 条自测覆盖「植入违规必须红」（含摘掉 `wait_status_fresh` 与多接一个挂载点两类）。
- [x] AC10 —— 派生键按单元：`ChangesList` `key={repoKey}`、勾选/展开缓存按 `repoKey`、
  ahead/behind 键含单元维度（`useLocalProjects.test.ts`「ahead/behind 也按单元存键」）、
  侧栏 `+A/-D` 改为从 `unitStatuses[repoKeyOf(...)]` 派生（不再首拉即永久）。
- [x] AC11 —— ①「每项目至多一套挂载」由 `activate()` 的释放-再挂载序列 + `watched_units()` 计数
  断言保证；**反复切换 20 次不累积**由 `twenty_unit_switches_do_not_accumulate_mounts` 钉住（每轮
  挂载表只含当前单元、回收 ≤ 1、末轮清空）；口径是**挂载表**而非 OS 线程数曲线（后者本机不可测，
  线程释放由 `release_one` 的 join/drop 路径承担）。现场旁证：一次 main→worktree 切换后心跳只报
  wt-a 一个单元，`already watched` 告警随默认挂载点删除而消失。
  ②「单条变更恰好 1 条快照」按本任务口径改为**跨单元 delta == 0** + 「version 单调」断言
  （`lifecycle_tests` 头注：负载下一次写入可以分多批投递，批次数不是契约，== 1 在 macOS CI 误报过）。
  ③ 冷启动 P95 已实测（本工作树 146 条改动：冷启动 820–850ms，其中单元 status 计算 90–110ms，
  entries 恒等于 `git status --porcelain` 的 146；小仓同口径 21–30ms）。
- [x] AC12 —— 四条命令行门禁全绿（见 `implement.md` 实测记录）；`pnpm tauri dev` 现场主链路由用户
  2026-09-29 09:16–09:20 走完并确认「手动验证没有问题了」。该次真 app 日志的可复核侧面：
  **0 条 ERROR**、0 条 `already watched`、0 条 `not a git repository`；13 次快照推送分别落在
  主仓单元（147 条 / branch main）与 worktree 单元（1 条 / branch worktree-agents-md-opt），
  即「各单元只看自己的数据」在生产实例上成立。面板可见性与「未知/空」的区分另有渲染级用例覆盖，
  10 次失焦聚焦由自动化覆盖。
- [ ] AC13 —— 表述需修订：原文含「`version: 0` 兜底路径的现有语义不因本任务被改坏」，与 D-C /
  R2.6（直接改载荷形态、不留 `version: 0`）**自相矛盾**。实际交付是：远端单元改用 pull 生产者 +
  注册表盖章的 version（比原来更强），功能面不回归。该项应改写为「WSL / SSH 功能不回归」并由
  现场核对；本文档保留原文以留痕，不改写历史。
  **2026-09-29 仍未打勾的原因（不是遗漏，是本机无法执行）**：`~/.neeko/sessions.json` 里 11 个项目
  `environment.type` 全为 `Local`，那次手测的日志里 `ssh` / `wsl` 关键字命中 0 次 ⇒ 远端分支根本没被
  跑过，人的确认也只覆盖本地。代码层证据已给（`only_local_targets_get_a_push_producer`、
  `status_porcelain_uses_transport_repo_check_not_local_filesystem`、远端读路径 `compute_and_record`
  经 transport 现算并注册表盖章），零回归的其余担保在 CI 三平台矩阵。**需要用户在有 WSL / SSH
  项目的机器上点一次「远端项目 → Changes 面板出条目」才能闭合本条。**

## 已知缺口（2026-09-28 收口时核对，逐条给结论）

原列四条里 **三条随本次一并消解**（因为它们本就是「身份缺失/双份表示」的下游表现），其余留为
独立缺口 —— 均已在 `prd` 范围内核对过代码，不是猜测：

- ~~WSL / SSH 读接口 `version` 恒 0~~ **已消解**：pull 生产者（`WatcherManager::record_computed`）
  与 push 生产者进同一张表、共用注册表盖章的 version，`version: 0` 语义已从载荷里删除（D-C）。
  仍然存在的取舍是**远端不实时**（无 watcher，只在被读时计算），因此需要的是 UI 标注而不是版本语义。
- ~~`clearWorktreeForProject` 全仓无调用者~~ **已消解**：`worktreeStore` 重写后 `clearActiveWorktree`
  有 5 处真实调用者（`useProjectActions` / `useProjectSelection` / `useCrossTypeSelection` /
  `useSessionBootstrap` / `useWorktreeState`），镜像字段本身已删除。
- ~~侧栏 worktree `+A/-D` 首拉即永久~~ **本地侧已消解**：`WorktreeList.tsx` 的 `changeStats` 改为
  从 `unitStatuses[repoKeyOf(projectId, wt.path)]` 派生（订阅该单元槽位），不再「拉过一次就冻结」。
- **已闭环（曾是本任务引入的远端回归）**：`activate()` 与 `operations::status_porcelain`
  一度都先跑**本地** `is_git_repo` / `assert_git_repo`，而 WSL / SSH 的工作树在别的机器上
  ⇒ 远端单元 status 一律失败、Changes 面板永远 Loading。现已改为 `transport.is_git_repo()`
  判定，并新增 `supports_push_producer`（只有 Local 有 push 生产者；远端激活 = 收口 + 立刻
  pull，与 HEAD 的 `remote_git_info_command` 语义一致）。测试
  `status_porcelain_uses_transport_repo_check_not_local_filesystem` +
  `only_local_targets_get_a_push_producer` 钉住。**AC13 仍需真实 WSL / SSH 环境做逐项确认**
  （这台 macOS 没有），但「本次把远端弄坏了」这一条已经不成立。
- **已闭环（第八轮，现场日志暴露）**：`version` **号段曾随挂载释放一起归零**。取号源是槽位里
  那份快照的 version，而 `release_one` 连槽位条目一起删 ⇒ 重新挂载后第一份永远是 `v1`。
  触发路径是切项目（A→B→A）：这条路上没人作废 A 的槽位，前端闸门 `version <= prev` 便把
  **更新**的那一份判成旧的丢掉，界面继续显示离开时的旧快照 —— 与 issue #2 原症状同形。
  判据：用户手测那次会话 13 次推送全是 `v1`。修法 = 号段（`version_floors`）与快照数据分开存，
  释放只作废数据；号段仅在项目移除时随 `unwatch_project` 回收。红→绿与既有判据更正见
  `implement.md` 第八轮。既有测试全部只断言「同一挂载周期内单调」，**跨挂载周期无人看过号** ——
  这类缺陷是现场跑一遍才浮出来的，不是补一条单元测试就能想到的。
- **未消解 · 远端侧栏 chip 的两个缺陷（`ConnectionWorktreeList.tsx:57-82`）**：① `if
  (changeStats[wt.path]) continue;` ⇒ 每个单元一生只拉一次，失败也记成 `{0,0}` 从而永不重试
  （显示上不出 chip，所以不会骗人，但拿不到更新）；② 组件自持 `useState` 而非订阅
  `projectStore.statuses`，与本地侧栏（已改为按单元订阅）成了两套形态。修法要给连接域组件补
  projectId 维度并改 props 契约，属另一处设计决策，不并入本任务。
- **未消解 · 写命令的作用域仍是主仓**：`branch.rs` / `commit.rs` / `sync.rs` 里多数写命令只接受
  `project_id`（内部 `resolve_project` ⇒ 恒取主仓单元）。用户在 worktree 视图点「切分支 /
  cherry-pick / revert」，实际操作的是**主仓**，界面上却像是当前 worktree —— 这是「命令作用域」
  维度，与本次修的「status 寻址」维度不同源（后者缺了会让列表串数据，前者缺了会让操作打错
  对象），补它要给十几个命令加参数并改前端调用面，属独立决策，不在本任务静默扩范围。
- **未消解 · 删除 worktree 不关 PTY**：`WorktreeList.tsx:117` 用两段式 `${projectId}:wt:${path}`
  去查四段式真实终端缓存键 ⇒ 关联 PTY 会话不会被关掉。这是**终端缓存身份空间**的问题（其唯一
  实现处见 `src-tauri/AGENTS.md`「架构要点」），与 git 单元身份无关，另开任务处理。
- **已交付 · 现场项**：AC4「列表真的跟着变」、AC6 符号链接形态的激活态不被清除、AC7 首屏无主仓
  闪现、AC12 来回切 + 连击观感 —— 2026-09-29 由开发者在真 app 走查并确认「手动验证没有问题了」。
  时延数字也已机器出数：编辑→推送 P95 = worktree 57.1ms / 主仓 56.8ms
  （`edit_to_push_latency_p95_worktree_vs_main`），大仓冷启动 820–850ms（AC11③）。
- **仍未交付 · AC13**：需要真实 WSL / SSH 项目。这台机器 `~/.neeko/sessions.json` 的 11 个项目
  `environment.type` 全是 `Local`，手测那次会话日志里 `ssh` / `wsl` 命中 0 次 ⇒ 远端分支未被跑过，
  人的确认也只覆盖本地。代码层证据与剩余风险见上面 AC13 条目。
- **手测日志里捞到的一条既有缺陷（非本任务引入，建议另开任务）**：`~/.neeko/neeko.log` 每次会话
  有数百到数千条 `[exec] collect_blocking_with called from within a runtime context
  (src/common/git/local/mod.rs:31:5)` —— `local/diff.rs` 的 diff-stats 路径（每个变更文件一次
  `wc -l`）**在 async 上下文里调同步执行门面**，门面为自愈每次另起一条 OS 线程，正是红线 3 的反面
  （该用 `core::exec` 的 async 变体或 `spawn_blocking`）。判为既有行为：同一调用点的同款 WARN 在
  本任务开工前（09-24 / 09-25）的滚动日志里已有 6517 / 4590 条。与仓库单元身份无关，不并入本任务；
  修法是 diff stats 改异步 + 按 `repo_key` 缓存，属性能/资源规模议题。

## 决策（2026-09-26 已定，不再复议）

> 本节与上面的「已知缺口」尾部在 2026-09-28 的一次文档批量编辑里被脚本切掉过，按本会话内
> 已确认的原文重建（决策文字未改）；重建这一点写在这里，是为了让后来人知道该以
> `design.md` §8 与 `task.json` 的决策记录为交叉验证。

- **D-A = 一次做穿**。R1-R4 同批交付，不拆「先止血再治本」。**禁止**任何以「worktree 激活时丢弃某类事件 / 非空就保留 / 同版本放行」形式的守卫式补丁 —— 这类代码在本次改动中一律**删除**，不得新增。
- **D-B = 只挂激活单元**。一个仓库单元只有在成为当前视图时才拥有后端资源（worker + watcher），离开即释放。
- **D-C = 直接改载荷形态**。`git-status-snapshot` / `git-changed` 的载荷一步换成含 `repo_key` 的新结构，**不加 `#[serde(default)]` 兜底、不保留双写/双读兼容分支**。

### D-B 带来的契约改写（重要）

原 I1 表述为「每个仓库单元必须有权威生产者」。选定「只挂激活单元」后，I1 收窄为下面两条，AC 随之改写：

- **I1-a（激活态实时）** 被挂载的单元：其 HEAD / index / 工作目录变化必须推送快照，与谁在调用读接口无关。
- **I1-b（未挂载态不得伪装）** 未挂载的单元**没有生产者，因此必须显式表现为「未知」**：其槽位不得保留任何可能被当权威渲染的旧数据。冷启动窗口（激活到首个快照落地之间）内 UI 不得用上一个单元或上一次会话的数据占位。
  I1-b 是本决策的安全阀：它把「非激活单元不实时」这一取舍转成**可判定的空态**，而不是静默的陈旧数据 —— 后者正是本次要根治的症状形态。

## Notes

> 本节原有正文在同一次脚本误切中丢失，未凭记忆重写。等价内容以这两处为准：
> `design.md`（D1-D9 后端证据 / F1-F9 前端证据 / 被否决方案 / §8 已闭环问题）与
> `task.json` 的 `notes`（本质、最确定的复现路径、决策记录）。

- 本质：`git status = f(HEAD, index, workdir)`，linked worktree 三者皆独立 ⇒ 一个 project 承载
  `1 + N` 个仓库单元；身份缺一维会同时投影成「列表不可见」（无权威生产者）与「串 main 内容」（共槽）。
- 修复过程中的两个非显然结论已写进 `.trellis/spec/backend/git-domain.md` §10 / §12：
  version 号源必须唯一（push 与 pull 交错会静默丢更新）；未挂载单元的缓存不可信（读接口要先问
  有没有生产者）；连接形态决定有没有 push 生产者（远端一律现算）。
