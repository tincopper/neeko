# Implement — Worktree 场景 Git status 身份单点化

> 配套 `prd.md`（AC）与 `design.md`（模型）。决策已关闭：**D-A 一次做穿 / D-B 只挂激活单元 / D-C 直接改载荷形状**。
> **禁止**分阶段止血、禁止兼容分支、禁止保留 R5.2b 删除清单里的任何一条。

## 执行原则

1. 后端与前端必须**同一批**落地（载荷换形状后不存在可用的中间态）；每个 Step 结束时仓库可编译、可跑测试。
2. 先红后绿：每个 Step 的第一步是写会失败的契约测试。
3. 每步跑最小回归集：`pnpm lint` + `pnpm type-check` + `pnpm test:run` + `cargo test --manifest-path src-tauri/Cargo.toml`。

## Checklist

### Step 0 · 基线留档（不动代码）

- [x] 0.1 基线 commit `1739cc70`；记录改动前现场三组证据（写入本文件末「实测记录」）：
      ① worktree 激活 → 失焦/聚焦一次 → 面板内容变化；② worktree 内 `git add f` → 面板是否自动更新；③ 冷启动首个快照时延。
- [x] 0.2 现场夹具与真值口径（2026-09-28 已按下法跑通后端侧，UI 侧待眼睛）
  - **交付物 `tools/worktree-handtest.sh`**：一条命令建好下面整套夹具（独立 `HOME` + repo +
    两个同级 linked worktree + 各单元自己的脏改动 + 故意写成符号链接形态的激活单元），
    并打印真值命令与待人工确认的 4 项；`--run` 直接起 vite + dev 二进制。已用它在
    `$TMPDIR/neeko-wt-handtest` 上端到端验证过（主仓挂载 → 释放 → 恢复 `wt-a` 单元，
    `entries=1` 与 `git -C wt-a status --porcelain` 一致）。
  - 夹具配方（全在 `/tmp`，不碰任何真实仓库）：
    `git init repo && 提交一次 && git worktree add -b feat-a ../wt-a && git worktree add -b feat-b ../wt-b`，
    然后在 `wt-a` 里改一个跟踪文件 + 新建一个未跟踪文件。
  - 隔离运行（避免与已安装的 Neeko.app 抢 `~/.neeko/`）：`pnpm dev` 起 vite，
    `HOME=/tmp/<fixture>/home ./src-tauri/target/debug/neeko`，状态文件写
    `{"projects":[{...,"path":"/tmp/<fixture>/repo"}],"active_project_id":...,
    "worktree_state":{"<pid>":"/tmp/<fixture>/wt-a"}}`（刻意写成 `/tmp` 这种符号链接形态以覆盖 AC6）。
  - 读的是该 HOME 下自己的 `neeko.log`；真值口径仍是 `git -C <wt> status --porcelain`。
  - 冷启动时延也能量：日志里 `Started watching unit …` 与同单元首条 `Emitting snapshot v1 …`
    的时间差即「激活到首个快照」（本次实测 21–30 ms，小仓库）。

### Step 1 · 后端身份层：`RepoRef` + canonical 路径（R1、D7/D8）

- [x] 1.1 **红**：`src-tauri/src/common/git/repo_ref/tests.rs`
      ① `Main` 与 `Linked` 的 `key()` golden 字符串；② 同一路径的符号链接/尾分隔符形态 → 同一 key；③ 两个 linked worktree → 两个不同 key；④ key 与前端 `repoKeyOf` golden 对齐。
- [x] 1.2 新增 `common/git/repo_ref.rs`（`RepoRef`/`WorktreeRef`/`key()`/`from_path()`/`Serialize`），`git/mod.rs` 只加 `mod`+`pub use`（红线 9）。
- [x] 1.3 `common/git/path_guard.rs`：`resolve_validated_work_dir` 返回 canonical 后的 `String`（不再丢弃 canonicalize 结果）；`validate_worktree_path` → `canonicalize_worktree_path` 语义；单测覆盖（夹具全部 `tempdir()` 派生，红线 13）。
- [x] 1.4 工作树清单单一化：`operations/worktree.rs::parse_worktree_list` 成为唯一实现（`git worktree list --porcelain`），主仓条目按 `git rev-parse --git-common-dir` 判定剔除，删除 `info.rs:106-110` 的 `remove(0)` 位置假设；`local/worktree.rs` + `local/branch.rs:46` 的 libgit2 实现退役。清单内 path 一律 canonical。
- [x] 验证：`cargo test --lib repo_ref`、`cargo test --lib path_guard`、`cargo test --lib worktree`、`cargo clippy -- -D warnings`、`cargo fmt --check`。

### Step 2 · 后端生产者：`WatcherManager` 按 `RepoRef` 实例化（I1-a、AC3/AC4/AC5/AC11）

- [x] 2.1 **红**：`status_worker` 与 `manager/lifecycle_tests.rs` 扩展
      ① linked worktree fixture：worktree 内改文件 → 该单元 version 前进、主仓单元无事件；② 主仓内改文件 → 主单元前进、worktree 单元不产出（未挂载即无生产者）；③ `watch(A)→unwatch(A)→watch(B)` 后线程/套数不累积；④ 重复 `watch(同一 RepoRef)` 幂等（只建一套）。
- [x] 2.2 `WatcherManager`：`watchers`/`snapshots` 主键 → `RepoRef`；`watch(RepoRef, sink)` 内部 workdir/gitdir 全部取该单元（文件 watcher 根 = 单元 workdir）；`snapshot(&RepoRef)`、`poke_status_worker_and_wait(&RepoRef, ..)`、`gitignore_for(&RepoRef)`、`unwatch(&RepoRef)` 同步改签名。
- [x] 2.3 退役跨目录补挂：删 `git_meta/paths.rs::resolve_worktree_roots`、`GitMetaPaths::has_worktrees`、`watcher.rs::rearm_worktrees_if_needed`、`on_worktree_meta_changed` 回调与 `classify.rs::WorktreeMetaChanged` 分支（连带其测试）；`.git/worktrees/**` 事件不再进任何单元。
- [x] 2.4 新增命令 `set_active_repo_unit(project_id, worktree_path: Option<String>)`（`git/commands/` 或 `project/commands.rs`，Command 层只做校验+调度，红线 6）：内部 = 释放该项目其它单元 → 挂载目标单元 → 有界等待首个快照（复用 `RECALC_WAIT_TIMEOUT`）。经 `run_blocking` 隔离（红线 3），注册进 `lib.rs` 的 `neeko_invoke_handler!`。
- [x] 2.5 `app.rs:96-108` 与 `project/commands.rs:124-141,309-315` 的 watch 调用点改为 `RepoRef`（默认 Main 单元）；`unwatch` 在 project 移除时释放该项目全部挂载（至多一套）。
- [x] 2.6 载荷换形状（D-C，无 `serde(default)`）：`GitStatusSnapshot { repo_key, project_id, worktree_path, version, branch, entries, truncated }`、`WatcherEvent::GitChanged { repo_key, .. }`；`sink.rs` 枚举分支同步（红线 5：事件名不变）。
- [x] 验证：`cargo test --manifest-path src-tauri/Cargo.toml`（lib + unit 两个 target 全跑）。

### Step 3 · 后端读接口与写后 poke 单点化（R2.4、R3、AC8）

- [x] 3.1 **红**：双入口一致性用例（形态已随 R3.3 变更，见文末「实测记录」3.1 条目（同一 fixture 作为主仓 / 作为 linked worktree 取条目，逐字段相等，含 `renamed_from`、`is_dir`、XY）。
- [x] 3.2 `git/commands/query.rs`：`get_worktree_changed_files` / `get_git_info` 一律读 `RepoRef` 快照；删 `version: 0` 分支与 `ChangedFilesPayload.version` 的「0 = 无语义」约定（改为 `version` 恒 > 0 的必填语义或整体去掉该字段 —— 取前者，前端不再需要判定）。
- [x] 3.3 删 libgit2 第二引擎：`operations/files.rs::get_worktree_changed_files` 的 `open_repo` 分支、`local/status.rs::get_changed_files_from_repo` 及其生产调用；旧引擎测试迁移为 `parsers::status` 等价断言（不留活体测试）。
- [x] 3.4 `wait_status_fresh(&RepoRef)` 铺满写命令：`git/commands/index.rs` 5 处 + `commit.rs::commit_files` + `worktree.rs` create/remove/rename（D6 缺口）；同步更新 `.trellis/spec/backend/git-domain.md` §10 的契约主键表述。
  - 交付时覆盖面**大于**本条点名范围：另补 `cherry_pick` / `revert` / `rename_branch` / `checkout_branch` / `create_and_switch_branch` / `checkout_detached` / `stash_apply` / `stash_pop` / `pull*`（§10 的契约主语是「任何写命令」，不是清单）；`remove_worktree` / `rename_worktree` 额外 `release_unit` 释放挂载，且 `RepoRef` 必须在破坏性操作**之前**解析（目录消失后 canonicalize 退化为词法归一，符号链接根上会得到与挂载时不同的 key）。接线由护栏第 4 类判据静态钉住 —— 命令层需要 `State<AppStateWrapper>`，`cargo test` 跑不了。
- [x] 验证：`cargo test`、`cargo clippy -- -D warnings`。

### Step 4 · 前端身份与状态分槽（R1.1/R4.1、AC1/AC2/AC7/AC9/AC10）

- [x] 4.1 **红**：`src/shared/utils/__tests__/repoRef.test.ts`（golden 与后端对齐）+ `src/shared/store/__tests__/projectStore.status.test.ts`（`applyStatus` 是唯一写入口、gate 按 key、未挂载单元的槽为 `unknown`）。
- [x] 4.2 新增 `src/shared/utils/repoRef.ts`：`RepoKey`、`repoKeyOf(projectId, canonicalWtPath?)`、`parseRepoKey`。**唯一**拼接点（`tabKey.ts` 保持既有 tab 空间语义，不重复发明也不得被绕过）。
- [x] 4.3 `projectStore`：`statuses: Record<RepoKey, RepoStatus>` + `applyStatus(repoKey, snapshot)` 唯一写入口（内部 per-key version gate）+ `invalidateStatus(repoKey)`；删除 `git_info.changed_files`、`git_info.is_clean`、`statusVersionByProject`、`applyGitStatus`、`versionGateAccepts` 的 `version<=0 恒放行`；`branch` 归入 `RepoStatus`（单元级）。
- [x] 4.4 删 R5.2b 清单里的前端旁路：`useRefreshGitInfo.ts:44-60`、`useSessionBootstrap.ts:53-67,137-160`、`useLocalProjects.ts:84-99` 全部改道 `applyStatus`；`useGitStatusEventsSync.ts:119-122` 守卫删除；`gitStatus.ts:78` 的 `allowEqual` 与 `:28-41` 的 debounce key 改为 `RepoKey`。
- [x] 4.5 `refreshGitFileStates(projectId, worktreePath)` → `refreshStatus(repoKey)`；所有调用点的目标单元由 §5.1 的唯一派生函数给出。
- [x] 验证：`pnpm type-check`（未改道处必然报错 = 回归面清单）、`pnpm test:run`。

### Step 5 · 前端「激活单元」单一表示 + 后端挂载贯通（R2.1/R2.5、AC5/AC6）

- [x] 5.1 **红**：`worktreeStore` selector 测试（每项目唯一、无镜像漂移）、`useAppShellData` 存活判定测试（canonical 形态不被误判为已消失）、`useLocalProjects` 跨项目不串测试。
- [x] 5.2 删 `worktreeStore` 的 `activeWorktreePath` / `activeWorktreeBranch` / `openedWorktrees` 三个镜像字段；只留 `byProject: Record<projectId, WtUnitState>`；新增 `useActiveWorktree(projectId)` hook 与 `selectActiveWorktree(state, projectId)` 纯函数；`clearWorktreeForProject`（无调用者）删除。
- [x] 5.3 迁移全部消费者（约 40 处，`grep -n "activeWorktreePath"` 为清单）：React 侧传显式 projectId，命令式侧 `selectActiveWorktree(getState(), activeProjectId)`。
- [x] 5.4 视图激活唯一入口：`useWorktreeState` 的 setter → 单一 `activateRepoUnit(projectId, worktreePath|null)`，内部调 `set_active_repo_unit` + 写 selector 状态 + `invalidateStatus(旧 key)`。`GitControlPanelWrapper.tsx:34-36` 之类「effect 监听镜像再刷新」的形态删除。
- [x] 5.5 冷启动窗口空态：`statuses[key]` 缺失或 `unknown` → Changes 面板/侧栏徽标/文件树着色显式走 loading/未知，不得沿用上一单元数据（I1-b）。
- [x] 5.6 `session` 持久化与 `byProject` 合一（删 `useSessionPersistence` 里第三份 `worktreeState` map），加载时以 canonical 校验 + 显式回落。
- [x] 验证：`pnpm type-check`、`pnpm test:run`。

### Step 6 · 派生键与护栏（R4.3、AC9/AC10）

- [x] 6.1 `ChangesList` 的 `key` → `repoKey`；`useUntrackedDirExpansion` 的 `dirFilesMap` 作用域按 `repoKey`；`useFileSelection` 勾选集按 `repoKey`；`aheadBehindKey` 加单元维度；侧栏 worktree `+A/-D` 改为订阅该单元 `statuses`（删「首拉即永久」）。
- [x] 6.2 新增护栏并自测：`tools/guards/checks/`（自注册脚手架，见 commit `f431274a`）加一条「`changed_files` / `statuses` 写点只能出现在 `projectStore.ts`」的扫描 + 台账；`pnpm guards list` 确认注册；临时植入违规必须红。
  - 实际落地为 `check_repo_unit_identity.py` 的 **5 类判据**（退役符号 / 镜像属性 / status 命令出口 +
    key 产出单点 / **写命令收口接线** / **挂载唯一入口**），共 13 条判据自测（合计 169 条护栏自测）；
    刻意不配 debt 台账 —— 要的是永远为零。
- [x] 验证：`pnpm lint`（含新护栏）、`pnpm guards list`。

### Step 7 · 全量门禁 + 现场验证

- [x] 7.1 门禁逐条：（`pnpm lint` / `pnpm type-check`+`lint:fe` / `pnpm test:run` / `cargo test` 四条命令行门禁全绿；`pnpm tauri dev` 等价物已跑 —— 隔离 `HOME` 下起 vite + dev 二进制并读它自己的日志，见文末现场实测；**唯缺视觉观测**，本机 `screencapture` 无屏幕录制权限）
```bash
pnpm lint          # fmt + clippy(-D warnings) + 全部护栏 + java-host
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri dev
```
- [x] 7.2 现场：主仓 ↔ worktreeA ↔ worktreeB 交替、worktree 内编辑/stage/commit、失焦聚焦 10 次、启动恢复激活 worktree 首屏、删除 worktree、大仓冷启动时延。逐条对照 AC1-AC13 打勾并记入「实测记录」。
  - 2026-09-28 更新：本条里**可自动化的部分已全部搬走** —— 「失焦聚焦 10 次」有专项用例
    （`useGitStatusEventsSync.test.ts` 假计时器 10 轮）；worktree 内编辑/stage 的推送与真值一致性、
    卸载单元零泄漏、切换后只剩一套挂载，均由隔离 HOME 的真跑日志证实（见上方现场实测）。
  - 真正剩下的只有需要眼睛的三项：Changes 面板的可见性与切换闪现、启动首屏观感、大仓冷启动时延。
    本环境无屏幕录制权限（`screencapture` 报 `could not create image from display`），
    且用户已安装的 Neeko.app 与 dev 实例共用 `~/.neeko/` ⇒ 需用户退出它后按 0.2 的夹具配方手测。  - （2026-09-28 尝试记录：`pnpm tauri dev` 起来后**无法**由 AI 侧核对现场 —— ① `screencapture` 无屏幕录制权限（`could not create image from display`）；② 用户机器上 `/Applications/Neeko.app`（PID 14546，自 09-25 常驻）与 dev 实例共用 `~/.neeko/`（`sessions.json` / `neeko.log` / `worktrees/`），dev 实例会改写真实会话状态，且两边写同一个日志文件导致读数混旧实例（`core:335` 等旧行号）—— 已停掉 dev 实例。**要跑现场请先退出已安装的 Neeko.app**，或给 dev 指定独立 state 目录。）
  - **2026-09-29 收口：本条由开发者本人在真 app 走查通过（原话「手动验证没有问题了」）** ⇒
    AC4 / AC6 / AC7 / AC12 随之打勾。可复核的旁证取自那次会话自己的日志
    （`~/.neeko/neeko.log`，09:16:40–09:20:50）：**0 条 ERROR**、0 条 `already watched`、
    0 条 `not a git repository`；13 次快照推送分别落在主仓单元（147 条 / branch main）与
    worktree 单元（1 条 / branch `worktree-agents-md-opt`），即每个单元只看自己的数据；
    28 次 `Running git status` 均在被激活的单元上。AC13 不在其中 —— 那次会话 `ssh` / `wsl`
    命中 0 次，且 11 个项目全是 `Local`，远端分支本机无从执行，仍留开。

- [x] 7.3 红→绿双向验证留痕：至少 3 条关键契约测试「回退修复即失败」的记录。（4 条，见文末留痕清单）

### Step 8 · 知识沉淀（不产代码）

- [x] 8.1 `.trellis/spec/backend/git-domain.md` 新增「仓库单元身份（RepoRef）与 status 生产者」一节（含 §10 契约主键更新）。
- [x] 8.2 `.trellis/spec/frontend/state-management.md` 补「单元分槽 + 禁止全局镜像 + 唯一写入口」。
- [x] 8.3 根/子 `AGENTS.md`：只在既有落点补链接，不新增红线正文（`check_agents_md_size.py` 会校验体积与落点唯一）。
- [x] 8.4 prd.md「已知缺口」四条按用户指示决定：随本次一并收编 or 拆子任务（不得静默扩范围）。
- [x] 8.5 `trellis-finish-work`：跑门禁 → `add_session.py` 记录本会话 → **不主动提交代码**（用户要求）。

## 实测记录（开工后填写）

- 基线（改动前）：commit `1739cc70`。三条现场证据已在 `design.md` 的证据表里逐条落到
  `文件:行号`（后端 D1-D9 / 前端 F1-F9），此处不重复：S1 串内容 = 共槽（`projectStore`
  per-project `git_info.changed_files`）+ per-project version 计数；S2 列表不可见 = worktree
  视图无权威生产者（watcher 只按 project 建）+ `version: 0` 读接口；S3 静默降级 = 靠全局镜像
  `activeWorktreePath` 猜身份 + `resolve_validated_work_dir` 校验后丢弃 canonical 结果。
- Step 1-3（后端）之后：`cargo test --manifest-path src-tauri/Cargo.toml`
  = **1360 passed / 0 failed / 3 ignored（lib）+ 103 passed / 1 ignored（integration）**；
  `cargo fmt --all -- --check` 与 `cargo clippy -- -D warnings` 干净。
- Step 4-6（前端 + 护栏）之后：`pnpm test:run` = **484 files / 4324 passed / 2 skipped**；
  `pnpm lint:fe`（eslint + `tsc --noEmit` + `vitest run --typecheck`）= 0 error / Type Errors none；
  `pnpm lint` = 7 条护栏全过（`check_repo_unit_identity` 扫描 1373 文件、0 违规）+ 160 条护栏自测
  + java-host 21 条。迁移期间前端失败数轨迹 **43 → 8 → 0**（每删一条旁路就把它的测试一起改道）。
- **红→绿留痕（本次亲验）**：`linked_worktree_edit_pushes_versioned_snapshot_without_manual_poke`
  先红 —— 现场是 `git-status-snapshot` 事件已经收到、但 `manager.snapshot(&unit)` 为 `None`：
  `watch()` 尾部那句 `drop_snapshot_if_present` 会把 worker 在 `check()` 里刚产出的**首个**快照
  删掉（顺序 bug，非夹具问题）。把该句移到 `worker.check()` 之前后转绿。
  连带修正 `unwatch_drops_only_that_unit_snapshot` 的「重挂载后槽位必须为空」断言 —— 它此前
  **只有在这个 bug 存在时才成立**，是 bug 的副产品；改成断言真正的契约「新纪元或未知」（条目必须
  已含切走期间的变更，且 version 回到 1 而不是承接旧槽位）。
- **反向证据（同一测试暴露的第二个事实）**：`version` 曾有两个号源（worker 线程私有计数器 / pull 走
  注册表 `prev+1`），交错时必然出现平手 —— 前端闸门 `version <= prev ⇒ 丢弃` 会静默丢掉更新。
  现统一由注册表盖章（`store_snapshot`），并补 `pull_cannot_overwrite_a_live_push_snapshot` +
  `unmounted_pulls_advance_the_same_registry_sequence` 两条钉住。
- 3.1 形态变更（不静默改范围，留痕）：原计划写「同一 fixture 经主仓入口与 linked worktree 入口取
  条目逐字段相等」。R3.3 删除 libgit2 第二引擎后，"两引擎一致"失去对象，等价断言改挂在
  `parsers/status.rs`（XY / `renamed_from` / `is_dir` / unmerged 不丢弃）与「两生产者同表同号」两条
  manager 测试上。
- 第二轮（R2.4 覆盖面补齐 + 护栏第 4 类判据）之后：`cargo test` 仍 1360 + 103 全绿，
  `cargo fmt --check` / `cargo clippy -- -D warnings` 干净；`pnpm lint:fe` = 485 files /
  **4327 passed** / Type Errors none（新增 `WorktreeList.test.tsx` 3 条：删除单元后槽位作废 +
  激活态回落主仓、删除命令失败时**不**作废、改名后旧 key 作废且激活态改指新路径）；
  护栏 7 条全过 + **165** 条自测（其中 5 条是新增的「写命令收口」判据用例）。
- **红→绿留痕清单（7.3）**：
  1. `linked_worktree_edit_pushes_versioned_snapshot_without_manual_poke` —— 现场先红（事件已推送、
     槽位却为 `None`），把 `drop_snapshot_if_present` 移到 `worker.check()` 之前转绿；
  2. `unwatch_drops_only_that_unit_snapshot` —— 旧断言「重挂载后槽位必须为空」只在上述 bug 存在时
     成立，改为「新纪元或未知」后重新证红再转绿；
  3. `pull_cannot_overwrite_a_live_push_snapshot` —— 摘掉 `record_computed` 的挂载中守卫即失败
     （代码里保留为可复现断言；本轮因安全策略不允许临时改生产守卫来跑，判据本身有单测覆盖）；
  4. 护栏「写命令必须收口」—— `test_write_command_without_status_closure_is_a_violation` 就是
     植入违规必须红；`test_ledger_entry_cannot_borrow_a_mutating_name` 防台账腐化绕过。
- **第五轮的远端回归（自查发现，先红后绿）**：删掉命令层的默认挂载后，远端项目只剩
  `activate()` 一条路，而它用**本地** `is_git_repo` 判存在性 ⇒ WSL / SSH 的 Changes 面板
  永远停在 Loading（HEAD 走 `remote_git_info_command` 经 transport 现算，不受影响 ⇒ 确证是
  本次引入而非既有）。改为 `transport.is_git_repo()` + `supports_push_producer`，两条新测试
  在旧代码上必红。

- **现场实测（2026-09-28，隔离 `HOME=/tmp/neeko-ac12/home` 跑 `target/debug/neeko` + vite）**：
  夹具 = 真实仓库 + 两个 linked worktree（`git -C <wt> status --porcelain` 为真值口径），
  session 里把激活单元写成**符号链接形态** `/tmp/neeko-ac12/wt-a`（正是要复现 AC6 的那类形态）。
  读的是隔离 HOME 下的 `neeko.log`，与用户已安装的 Neeko.app 完全无关（那次跑之后已删除夹具）。

  ```text
  16:50:04.491 Started watching unit ac12-0001\0 at /private/tmp/neeko-ac12/repo      ← 激活态未就绪时的主仓
  16:50:04.521 Emitting snapshot v1 for .../repo (branch main): 0 entries
  16:50:04.567 released unit ac12-0001\0                                              ← release_except 回收
  16:50:04.569 Started watching unit ac12-0001\0/private/tmp/neeko-ac12/wt-a         ← 恢复成后端 canonical 形态
  16:50:04.590 Emitting snapshot v1 for .../wt-a (branch feat-a): 2 entries
  16:51:08.689 Emitting snapshot v2 for .../wt-a (branch feat-a): 3 entries           ← 现场 git add，无手动刷新
  ```

  - AC6 / AC7 通过：非 canonical 的 session 路径经后端归一后恢复为 worktree 单元；
  - AC4 通过：在 wt-a 里新建文件 + `git add` ⇒ 该单元 `v1(2 条) → v2(3 条)` 自动推送，
    与 `git -C wt-a status --porcelain` 真值逐条一致（`M README.md / A live-edit.txt / ?? changed-in-a.txt`）；
  - AC5① / AC11① 通过：同一时刻在主仓写文件（主仓已卸载）**没有任何推送**，心跳只剩 wt-a 一个单元，
    `already watched` 告警消失；
  - 这轮实测同时抓出两个只在真跑时才暴露的缺陷（见下方留痕 5、6）。
- **红→绿留痕补充**：
  5. `useSessionBootstrap.test.ts`「session 存的是符号链接形态路径…」先红 —— 实跑时恢复回来的
     worktree 被存活校验立刻判没，挂载在 main ↔ wt-a 之间反复翻；修法是恢复流程先请后端归一
     （新增 `canonical_worktree_path` 命令）再比对清单，前端不猜路径形态（红线 12）。
  6. `useActiveRepoUnitSync.test.ts`「挂载失败不作判死…」先红 —— 我在挂载点里加的
     「失败 ⇒ 回落主仓」与 `useAppShellData` 的清单校验构成**两个判死点**，冷启动首轮快照超时即
     互抖；撤掉重复判死后收敛（失败只放开重发门闸，槽位保持未知）。

- **红→绿留痕补充（第四轮，DOM 层）**：新增 `GitCommitPanel.unit.test.tsx`（4 条）把 issue #2 的
  原始症状「changes 列表总是不可见 / 出现 main 中的内容」钉在**真实渲染输出**上：单元有权威快照 ⇒
  文件行真的出现；槽位缺失 ⇒ 渲染 `Loading changes…` 且**不出现**另一个单元的条目；快照为空 ⇒ 才是
  `No changes`；主仓 ↔ worktree 交替 ⇒ 每格只含自己的行。写它时先红（缺 `AppProvider`、缺
  `getChangedFilesDiffStats` 等容器依赖）→ 逐条补齐后 4 绿，说明此前这个容器根本没有被渲染级测试覆盖过。

- **冷启动 P95 与切换累积（已实测，取代旧「未实测」项）**：口径 A（冷启动）= 进程自身日志首行 →
  该单元首条 `Emitting snapshot`；口径 B（单元成本）= `Running git status for <path>` → 同单元 emit。
  被测仓库 = 本工作树（146 条未提交改动），4 次真启动（隔离 HOME，跑完清理）：
  A = 850 / 840 / 820 / 830 ms，B = 100 / 110 / 90 / 100 ms，entries 每次 146 与
  `git status --porcelain` 一致 ⇒ 身份链路只占 ~110ms，其余 ~700ms 是应用初始化（与本次无关）；
  小仓同口径 21–30ms。切换累积由 `twenty_unit_switches_do_not_accumulate_mounts`（20 轮）钉住。
  仍未量的只有像素级观感（无屏幕录制权限）。
- **第六轮自查抓到的两个远端漏洞（本任务引入，先红后绿）**：
  7. 删掉命令层的默认挂载后，远端项目只剩 `activate()` 一条路，而它与 `status_porcelain` 都用
     **本地** `is_git_repo` 判存在性 ⇒ WSL / SSH 单元 status 一律失败、Changes 面板永远 Loading
     （HEAD 的远端走 `remote_git_info_command` 经 transport 现算，不受影响 ⇒ 确证是本次引入）。
     改为 `transport.is_git_repo()` + 新增 `supports_push_producer`；测试
     `status_porcelain_uses_transport_repo_check_not_local_filesystem`（传一个本地绝对不存在的
     远端路径）与 `only_local_targets_get_a_push_producer` 在旧代码上必红。
  8. `read_unit_status` 先查缓存再看挂载 ⇒ 未挂载单元第一次 pull 的结果被永久当成权威返回，
     `refreshRepoStatus` 变成空操作（旧数据伪装成事实，违反 I1-b）。改为「先问有没有生产者，
     再决定能不能信缓存」：挂载中 ⇒ 缓存即权威；未挂载 ⇒ 每次读都经 transport 现算。
     此顺序无法在 `cargo test` 断言（要 `AppStateWrapper` 组合根），规则写进
     `.trellis/spec/backend/git-domain.md` §12 并注明不可测原因。

- **第七轮（收口复跑 + AC4 时延出数）**：
  1. 门禁复跑（PRD 尾修复之后）：`pnpm lint`（`cargo fmt --check` + `clippy -D warnings` +
     7 条护栏 / 169 自测 + java-host）exit 0；`pnpm type-check` exit 0；`pnpm test:run`
     487 文件 / 4340 通过 / 2 skip；`pnpm lint:fe`（含 `vitest run --typecheck`）Type Errors 0；
     `cargo test` 1364 lib（+4 `#[ignore]`）+ 103 integration（+1 ignore，另一 target 2 ignore）全绿。
  2. 上一轮 `lint:fe` 的单条失败（`records usage and forwards variable-free prompts directly`
     耗时 178727ms、且只收集到 479/487 个文件）复跑不复现 ⇒ 判定为机器负载抖动（该用例属
     agent-prompt 模块，与本任务无关），**不是**回归。
  3. **AC4 的时延现场项改为机器出数**：新增测量型测试
     `lifecycle_tests::edit_to_push_latency_p95_worktree_vs_main`（`#[ignore]`：测时序不测行为，
     进 CI 只会抖动），linked worktree 单元与主仓单元各采 20 轮「`fs::write` 返回 → 该单元快照
     version 前进」：worktree p50 47.7ms / **p95 57.1ms**，主仓 p50 43.9ms / **p95 56.8ms**
     ⇒ 差 0.3ms 在噪声内，worktree 单元没有被特殊拖慢（两者共用同一条
     notify → throttle → `worker.check()` → `store_snapshot` → `emit` 链路）。
     出数命令已写进 PRD 的 AC4 交付状态。AC4 剩下的只有「面板跟着变」的像素观测。
  4. PRD 修正两处**账面与事实不符**：AC11 条目里残留的半截句子（第六轮脚本误切的连带损伤，
     旧「线程数曲线未实测」与新「20 次切换不累积」拼在一起读不通）合并重写，并把口径写清是
     **挂载表**而非 OS 线程数；AC9 的护栏自测数 9 → 18（第五类判据「写命令收口 / 挂载单点」
     新增的自测未回写），判据列举同步补齐。

- **第八轮（现场日志暴露的第 8 个自引入缺陷：version 号段随释放归零，先红后绿）**：
  用户现场核对通过之后，回读他那次手测的 `~/.neeko/neeko.log`（09:16:40–09:20:50）发现
  **13 次快照推送全是 `v1`**。根因：`store_snapshot` 的取号取自槽位里那份快照的 version，
  而 `release_one` 把槽位条目一起删掉 ⇒ 号段归零。触发路径是**切项目**（A→B→A）：这条路上
  没人作废 A 的槽位（`invalidateStatus` 只出现在 worktree 切换 / 删除 / 改名 / 挂载失败四处），
  切回后 worker 的第一份快照 `v1 <= prev v3` 被前端乱序闸门静默丢弃 ⇒ 界面继续显示离开时的
  旧数据，要等 push 爬到 v4 才恢复 —— 与 issue #2 的原症状同形。这类缺陷所有既有测试都看不见：
  它们只断言「同一挂载周期内单调」，跨挂载周期的号没人看过。
  - 红：`remount_continues_the_unit_version_sequence`（挂载 v1 → 编辑 v2 → 释放 → 重挂，断言
    新快照 > v2；旧代码报「切回后的第一份是 1，而前端槽位里还留着切走前的 2」）与
    `pull_after_a_release_still_continues_the_sequence`（push/pull 共用号段；旧代码报
    「挂载首轮快照要接在同一号段之后：1 <= 2」）。
  - 绿：取号源改为 `version_floors`（每单元历史最高水位，与槽位数据**分开存**）；`release_one`
    只作废数据、不作废号段；号段仅在项目移除时随 `unwatch_project` 回收，规模以
    「项目 × 该项目的单元数」为界。取号与水位推进在同一次持锁里完成，两个生产者并发盖章
    不会撞号。
  - 既有判据更正：`unwatch_drops_only_that_unit_snapshot` 原来拿「重挂后 `version == 1`」当
    「槽位已作废」的证据，与新的单调性互斥 ⇒ 改为「新快照的号必须严格大于切走前的水位」
    （残留槽位的号不可能变大，这个判据更强）。
  - 前端契约同步钉住：`projectStore.test.ts` 新增「切项目回来时槽位可能未作废：入槽只看号大小，
    没有『重新挂载 ⇒ 号归零』的特例」—— 前端不得为此加特例，加了就把 pull 覆盖 push 的口子放回来。
  - 手测夹具脚本 `tools/worktree-handtest.sh` 补了一条专项清单项：「切项目 A→B→A 回来时不点刷新，
    列表必须是当前内容」（先 `touch probe.txt` 再切走切回，判据是真值）。这类跨挂载周期的缺陷
    只有现场按场景走一遍才会撞见，写进清单才算交付。
  - 第八轮门禁：`cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test`
    1366 lib（+2 新测试，4 ignored）+ 103 integration 全绿；`pnpm lint`（7 条护栏 / 169 自测 +
    java-host）exit 0；`pnpm test:run` 487 文件 / 4341 通过 / 2 skip；`pnpm type-check` exit 0。
