# Journal - tincopper (Part 5)

> Continuation from `journal-4.md` (archived at ~2000 lines)
> Started: 2026-09-25

---



## Session 230: git discard 统一入口 + 写后快照新鲜度（watcher-lifecycle 任务收尾归档）

**Date**: 2026-09-25
**Task**: git discard 统一入口 + 写后快照新鲜度（watcher-lifecycle 任务收尾归档）
**Branch**: `main`

### Summary

discard 三入口两命令收敛为 discard_files(paths) 唯一入口（后端按仓库状态分类分派、pathspec 分批、rename 双侧恢复）；前端 DiscardIntent 纯函数域保证确认文案与执行范围同源，GitCommitPanel 297→236 行（useFileSelection/useDiscardConfirm/useGitDialogRequest 三 hook 下沉、JSX 回调稳定化）；GitExecError 补 exit_code、unstage 兜底改 rev-parse 确定性 HEAD 判定；status worker 新增 started/completed 进度对与 check_and_wait 有界等待（1.5s 上限，命令层经 run_blocking），消除写后首刷旧值窗口。审核 4 Nit 全部优化。为 09-24-watcher-lifecycle-and-git-lock 任务补 Step 4 收尾：AC1 现场复验（29 批次零重复发射）+ 全门禁复跑（lib 1362 / integration 103 / 前端 4250）+ spec 沉淀（git-domain §9-11、concurrency watcher 所有权契约）后归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f2fd39ca` | (see git log) |
| `53ebc610` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 231: AGENTS.md 治理收口（体积预算/台账校验/章节去重）+ 贡献指南去镜像

**Date**: 2026-09-25
**Task**: AGENTS.md 治理收口（体积预算/台账校验/章节去重）+ 贡献指南去镜像
**Branch**: `main`

### Summary

AGENTS.md 治理收口：护栏体积预算由「三文件求和」改为「root + 单个嵌套」（Codex 只拼 cwd 祖先路径；修正前仅剩 951 B 余量，且真实危险组合无人监控）；红线台账新增摘要列（嵌套未加载时的兜底）与「行标题必须含签名」校验（抓出红线 14 标题漏「必须」）；非红线章节全量去重（root 的目录/编号/playbook 副本 + 侧文件已漂移的目录表与重复的 TDD/覆盖率阶梯）；清算旧 neeko-check「支柱」编号体系（支柱 12 = 现红线 5，不能按数字平移），src/ 与 src-tauri/ 已清零；中英两份贡献指南由规则镜像改为落点索引并修掉 6 处漂移。护栏单测 26（+12）。

### Main Changes

AGENTS.md 治理收口（A→F）+ 贡献指南去镜像，3 个提交。

**A 体积预算口径修正** —— `check_agents_md_size.py` 的 `TOTAL_CAP`（三文件求和）改为
`PAIR_CAP`（root + 单个嵌套）。依据：Codex 只拼接 cwd 的**祖先路径**，三份永不同时加载；
求和设限既凭空压低预算（修正前合计仅剩 951 B 余量，而单文件各自还显示 13%/64%/42%），
又漏监控真实危险组合。单文件上限统一 16 KiB（原 14,336/18,432/18,432，其注释「实测值 +20%」
与常量不符）。

**D 台账摘要列** —— 红线表新增「必须 / 禁止（摘要）」列，作为嵌套文件未加载时的最小可执行
摘要（校验非空 + ≤200 B）。此前 root 只有规则标题，Codex 从仓库根启动时 agent 拿到的是规则名
而非可执行判据。摘要只在表格行内、不参与落点判定，故不会变成第二份正文。

**C 台账标题校验** —— `report_ledger` 新增「行标题必须包含该编号签名」，抓出真实漂移：红线 14
台账标题漏「必须」（正文标题一直带）。经**变异测试**验证有牙齿（改回漂移态即 exit=1，还原后
与原文件 hash 逐字节一致）。约定补充：交叉引用一律写 `红线 N`，不复述标题 —— 复述标题即造
第二个名字；同时让「形态判定分不清引用与正文」在约定上不再需要分。

**B 非红线章节去重** —— root 侧删：src-tauri 子目录副本、红线编号清单（编号单源改为表格的
`全文位置` 列）、硬编码计数「11 / 1 条」、单侧 playbook（下放并回补信息）、入口点契约词；
侧文件删：跨栈规则枚举、重复的 TDD 硬约束句与覆盖率阶梯（改指针）、以及**已漂移**的目录副本
—— src-tauri 域目录表列了不存在的 `skill/`、漏了 `about/` `library/` `search/`，`src/shared`
漏了 `constants/` `events.ts`。漂移实证是「删副本而非修副本」的决策依据。

**E 测试死代码** —— 删 `reset_cache()`（`actual_homes` 已无 cache 参数，`__defaults__` 恒 None，
helper 与 2 处调用皆不做事）；`RealRepoTest` 显式钉住 `REAL_REPO`，不再依赖其他用例的
`addCleanup` 顺序。

**F 旧编号体系清算** —— `支柱 12` 经 git 历史证实是旧 neeko-check 体系的**正式术语**（15/13 条、
编号与现「红线」不同；`journal-4` 记「修支柱12双端硬编码」= Event 名常量化），故修正为**红线 5**
而非按数字平移（两体系条目不一一对应，`支柱 13` 在现体系无对应项）。全域清点：`src/` 与
`src-tauri/src/` 中「支柱」清零；其余编号引用（8/12/14/15）主题均正确；归档任务与工作日志中的
历史记录**不回改**（`.qoder/worktrees/**` 是独立 worktree 副本，不在范围）。

**CONTRIBUTING 中英双份收敛** —— 两份指南原本逐条镜像 AGENTS.md 规则，改为落点索引，保留人专属
内容（环境/快速开始/常用命令/提交规范/质量门/分支 PR/文档/发布）。同时修掉保留段落里的 6 处漂移：
Node.js 18+（实际 `engines` >=24）、pnpm 9.12.2（实际 `packageManager` 11.25.0）、`pnpm lint`
描述漏 6 个 Python 护栏 + 护栏单测 + Java host、lefthook hook 表缺 `tools/java-host/**` 与
`**/AGENTS.md` 两条、最小回归集自成一份定义、以及指向不存在章节的**悬空指针**。

**护栏覆盖边界** —— 护栏 docstring 新增「范围」条目：脚本只管 15 条红线与三份文件的体积，
非红线章节的去重靠元规则（「子目录清单一律以 ls / Glob 为准」）+ AI 审查（同红线 13 的处理方式），
并记录本次清理清单与漂移证据。`docs/` 已复核无规则镜像（命中项均为指向 AGENTS.md 的链接或
该文档自身主题）。

### 验证

- `check_agents_md_size.py` 通过（root 13,989 / 16,384；root+src-tauri 24,836 / 30,720）
- 护栏单测 **26 条 OK**（+12）；6 个 Python 护栏逐个通过
- lefthook：提交 1 走 `guard-agents-md`（26 测试 + 全量校验），提交 2 走完整 `pnpm lint:fe`
  （eslint + tsc + vitest typecheck），提交 3 走 `commitlint`；全程未用 `--no-verify`
- `vitest run terminalRenderer.test.ts` → 56 tests passed
- 9 个改动文件 NUL=0 / CR=0；中英贡献指南标题层级 13/13、14 个 TOC 锚点全部可解析

### 提交拆分约束（供后来者）

护栏脚本与它治理的 `AGENTS.md`（root）**必须同一提交**：新脚本要求 4 列表 / 旧表是 3 列 → 只提交
脚本则该提交护栏即红；反之只提交 4 列表则旧脚本解析失败。这比 `git add -p` 拆 hunk 更可靠，也避免
留下坏的中间提交。


### Git Commits

| Hash | Message |
|------|---------|
| `512d9cf6` | (see git log) |
| `f25d2ec0` | (see git log) |
| `e3b706df` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 232: 护栏脚手架：tools/guards 框架取代三份手抄清单

**Date**: 2026-09-26
**Task**: 护栏脚手架：tools/guards 框架取代三份手抄清单
**Branch**: `main`

### Summary

把 6 条 check_*.py 护栏迁进 tools/guards 框架：注册表=checks/ 目录本身（放文件即生效，删文件即下线），stage/scope 由护栏自述，package.json/ci.yml/lefthook.yml 三份手写清单收敛为三次单行调用。框架统一兜住仓库根定位（全仓一处，禁 parents[N]）、反空转（scanned=0 判护栏失效而非通过）、退出码三档（0/1/2 可区分违规与工具坏了）、强制配套单测。顺带修两处真实缺陷：font_family 与 codemirror 护栏此前只挂本地 lint、CI 从不执行；worktree 护栏的 git 术语表匹配不到 git_commit() 导致误豁免。台账数据（MANIFEST / SIZE_CAPS / SIGNATURES）外置到 ledger/*.json。pnpm lint + 110 单测全绿。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 233: Worktree 场景 git status 仓库单元身份补全（RepoRef 端到端）

**Date**: 2026-09-28
**Task**: Worktree 场景 git status 仓库单元身份补全（RepoRef 端到端）
**Branch**: `main`

### Summary

把 git status 的身份从 project 补齐到真实的 1+N 仓库单元（后端 RepoRef + 按单元挂载生产者 + 载荷换形状 + poke 单点化；前端 statuses 分槽 + applyStatus 唯一写入口 + 去全局镜像 + 挂载唯一发起点 + 护栏），并修掉过程中被新契约测试证红的两个真实缺陷（watch 首快照被删、version 双号源）。cargo test 1360+103、pnpm test:run 4324、pnpm lint 全绿；未提交代码，现场 pnpm tauri dev 手测待跑。

### Main Changes

# 会话：worktree 场景 git status 身份补全（任务 `09-26-worktree-repo-identity`）

## 做了什么

把「一个 project 一个 git 身份」补齐成真实的「1 + N 个仓库单元」粒度，端到端一次做穿（不打补丁）：

- **后端身份层**：新增 `common/git/repo_ref.rs`（`RepoRef` / `WorktreeRef` / `key()` =
  `{project_id}\u0000{canonical worktree path}`，NUL 作分隔符是因为它在 POSIX 路径里不可能出现，
  反解因此永无歧义）；`path_guard.rs` 改为 `canonicalize_worktree_path`（校验后**返回** canonical，
  不再丢弃）。`RepoRef` 刻意不携带 `ExecTarget`：目标是连接属性不是身份属性，且它不实现
  `Hash/PartialEq`。
- **生产者按单元实例化**：`WatcherManager` 的 `watchers` / `snapshots` 主键改成单元 key；
  删除跨 worktree 补挂那套机制（`resolve_worktree_roots` / `rearm_worktrees_if_needed` /
  `WorktreeMetaChanged`）—— 它存在的唯一前提是「worktree 没有自己的资源」，前提消失即退役。
  linked worktree 的 HEAD/index 在其私有 gitdir，由该单元自己的 git-meta watcher 监听。
- **删掉第二台 status 引擎**：`local/status.rs`（libgit2）整体删除，读路径只走 CLI porcelain +
  `parsers::status`；载荷一步换成含 `repo_key` 的新结构，不留 `version: 0` / `serde(default)` 兜底。
- **挂载唯一入口**：`git/services/status.rs::activate`（释放该项目其它单元 → 挂载目标 → 有界等待
  首个快照），前端唯一发起点 `app/hooks/useActiveRepoUnitSync.ts`；用户动作只写激活态。
- **前端分槽**：`projectStore.statuses: Record<RepoKey, RepoStatus>` + `applyStatus` 唯一写入口
  （per-key version 闸门，无 `allowEqual`、无「version<=0 恒放行」）+ `invalidateStatus`；
  `worktreeStore` 删掉三个全局镜像字段只留 `byProject`；未挂载 = 未知，`ChangesList` 新增
  `unknown` 形态（"Loading changes…" 而不是 "No changes"）。
- **护栏**：`tools/guards/checks/check_repo_unit_identity.py`（退役符号 / 镜像属性 / status 命令
  出口白名单 / 手拼 key 四类判据，命中即违规、刻意不配 debt 台账）+ 9 条自测，已进 `pnpm lint` 与 CI。

## 过程中修掉的两个真实缺陷（都由新契约测试先证红）

1. `watch()` 里 `drop_snapshot_if_present` 留在函数尾部：worker 线程可能在 `check()` 里就产出并
   插入首个快照，随后那句把它删掉 ⇒ 「已挂载却读不到权威数据」，只在首轮落地够快时复现。
   移到 `check()` 之前。连带发现 `unwatch_drops_only_that_unit_snapshot` 里「重挂载后槽位必须为空」
   这条断言**只有在该 bug 存在时才成立**，是 bug 的副产品 —— 改成断言真契约（新纪元或未知）。
2. `version` 曾有两个号源（worker 线程私有计数器 vs 注册表 `prev+1`），push/pull 交错必然出现平手，
   而前端闸门 `version <= prev ⇒ 丢弃` ⇒ 静默丢掉更新。改为注册表统一盖章（`store_snapshot`），
   事件载荷与槽位同源同号；并规定 pull 不得覆盖挂载中单元已有的 push 快照（晚到的 pull 必然更旧，
   但它盖的号还会看起来更新）。

## 质量门禁（全绿）

- `cargo test` 1360 passed（lib，含 15 条 `lifecycle_tests`）+ 103 passed（integration）
- `pnpm test:run` 484 files / 4324 passed / 2 skipped；`pnpm lint:fe` 0 error、Type Errors none
- `pnpm lint`：`cargo fmt --check` + `clippy -D warnings` + 7 条护栏（`check_repo_unit_identity`
  扫描 1373 文件 0 违规）+ 160 条护栏自测 + java-host 21 条
- 迁移期间前端失败数轨迹 43 → 8 → 0

## 知识沉淀

- `.trellis/spec/backend/git-domain.md` 新增 §12「仓库单元身份（RepoRef）与 status 生产者单源」，
  §10 写后 poke 的契约主键由 project 改为 `RepoRef`，「相关文件」清单去掉已删文件
- `.trellis/spec/frontend/state-management.md` 新增场景「仓库单元分槽 + 激活态单源」；
  2026-08-07 那条「generation Map」场景标记为已被取代（问题仍在，机制换了 —— 保留历史不删）
- `src-tauri/AGENTS.md` 补一条链接（体积仍在预算内：11,374B / cap 16,384B）

## 未完成 / 下一步

- **现场手测未跑**（需要人在 `pnpm tauri dev` 里看）：AC12 全链路、AC11③ 冷启动 P95 与切换 20 次
  线程曲线、AC3 逐命令（stage/unstage/discard/commit）视图更新、AC6 符号链接形态激活态
- 按用户指示**未提交代码**（工作树 136 个文件待用户自行提交）
- PRD 里 AC13 与 D-C 自相矛盾（它要求保住 `version: 0` 语义，而 D-C 明令删除）：已在 PRD 的
  「AC 交付状态」里记下，不改写历史条目
- 两条真实缺口未修（已核对定位）：`ConnectionWorktreeList.tsx:62` 远端侧栏 `+A/-D` 仍是
  「首拉即永久」；`WorktreeList.tsx:117` 删除 worktree 时用两段式键查四段式终端缓存键 ⇒ 关联
  PTY 不会被关掉（属终端身份空间，另开任务）


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 234: Worktree 身份收口第二轮：写命令全覆盖 + 单元生命周期 + 护栏接线判据

**Date**: 2026-09-28
**Task**: Worktree 身份收口第二轮：写命令全覆盖 + 单元生命周期 + 护栏接线判据
**Branch**: `main`

### Summary

审计 R2.4 后发现收口只覆盖 PRD 点名的四条命令，补齐 cherry_pick/revert/rename_branch/checkout_*/stash_*/pull*，删除与改名 worktree 时释放该单元挂载（RepoRef 必须在破坏性操作前解析），前端 WorktreeList 删除/改名后作废对应槽位并收口激活态；命令层接线改由护栏第 4 类判据静态钉住（命令层跑不起单测）。门禁：cargo 1360+103、fmt/clippy 干净、pnpm lint:fe 485 文件 4327 通过、7 条护栏 165 自测全过。未提交代码。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 235: Worktree 身份第三轮：隔离 HOME 真跑应用，修掉恢复/双判死/多发起点三个缺陷

**Date**: 2026-09-28
**Task**: Worktree 身份第三轮：隔离 HOME 真跑应用，修掉恢复/双判死/多发起点三个缺陷
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

# 会话：worktree 身份第三轮 —— 用隔离 HOME 真跑应用，抓出三个只有跑起来才暴露的缺陷

## 为什么这轮值得单独记

前两轮全靠 `cargo test` / `vitest`。这次用**隔离 `HOME=/tmp/neeko-ac12/home`** 起真实 dev 二进制
（不碰用户已安装的 Neeko.app 与 `~/.neeko`），配一个真仓库 + 两个 linked worktree 的夹具，
把 session 里的激活单元写成**符号链接形态** `/tmp/...` —— 这正是 AC6 要求覆盖的形态。
三个缺陷都是这么冒出来的，单测一个都没抓到。

## 修掉的三个真缺陷

1. **恢复的 worktree 被立刻判没（AC6/AC7 真失败）**：`useSessionBootstrap` 用
   `worktrees.find(w => w.path === persistedPath)` 判存活，而 session 里的路径是
   `canonical` 保证落地之前写下的形态（`/tmp` ↔ `/private/tmp`）→ 认不出 → 清激活态 → 回落主仓。
   这是 PRD R1.3 明令禁止的「裸字符串等值判定 worktree 存活」。
   修法：恢复流程先请后端归一（**新增 `canonical_worktree_path` 命令**，唯一归一实现仍是
   `path_guard::canonicalize_worktree_path`），再按 canonical 比清单。前端不 `realpath`、不剥尾分隔符。
2. **两个判死点互抖**：我在挂载发起点加的「IPC 失败 ⇒ 回落主仓」与 `useAppShellData` 的清单
   校验构成第二个判死点。冷启动首个快照还没落地时 `activate()` 返回 Err 是**正常现象**
   （快照由 worker 异步产出），于是 main ↔ worktree 反复重挂，日志里 80ms 内翻了三轮，
   每轮都在释放/重建 watcher 资源。修法：挂载失败只放开「同意图重发」的门闸、保留激活意图、
   槽位置为未知；判死只有清单校验那一处。
3. **挂载发起点其实不止前端一个**：`app.rs` 启动恢复与 `project/commands.rs::set_active_project`
   都按项目预挂主仓单元，实测每次启动都出现「先挂主仓、1 秒后改挂 worktree」并打出
   `already watched` 告警；而且旧写法只回收**同项目**的其它单元，切项目时上一个项目的挂载
   无人释放。修法：删掉两处默认挂载（`change_project_path` 的释放保留、不预挂），
   并把回收做成管理器级 `WatcherManager::release_except(keep)`（**全局**只留当前视图那一个，
   可单测，配 `activate_style_release_except_keeps_only_the_target_unit`）。

顺带：`useActivateRepoUnit` 现在把激活态改写成后端回传的 `worktree_path`（形态自愈），
`release_one` 抽出公共内核并补 `released unit <key>` debug 日志（红线 13：生命周期要可观测）。

## 现场硬证据（隔离实例日志）

```text
16:50:04.491 Started watching unit ac12-0001\0 at /private/tmp/neeko-ac12/repo
16:50:04.521 Emitting snapshot v1 for .../repo (branch main): 0 entries
16:50:04.567 released unit ac12-0001\0
16:50:04.569 Started watching unit ac12-0001\0/private/tmp/neeko-ac12/wt-a
16:50:04.590 Emitting snapshot v1 for .../wt-a (branch feat-a): 2 entries
16:51:08.689 Emitting snapshot v2 for .../wt-a (branch feat-a): 3 entries
```

- AC4：在 wt-a 内新建文件并 `git add` ⇒ 该单元自动推 `v2(3 条)`，与
  `git -C wt-a status --porcelain`（`M README.md / A live-edit.txt / ?? changed-in-a.txt`）逐条一致
- AC5① / AC11①：同一时刻往**已卸载**的主仓写文件 ⇒ 零推送；心跳只剩 wt-a 一个单元
- AC6 / AC7：session 的 `/tmp` 形态经后端归一后恢复成 wt-a 单元
- 启动无 panic / error，`already watched` 告警消失

## 新增/改动的测试

- `useSessionBootstrap.test.ts`：符号链接形态恢复用例（先红后绿）
- `useActiveRepoUnitSync.test.ts`（新文件，3 条）：同一意图不重发、失败不作判死、切换即改挂
- `useActivateRepoUnit.test.ts`：canonical 回写（+4 条，共 11 条）
- `lifecycle_tests.rs`：`activate_style_release_except_keeps_only_the_target_unit`

## 门禁（本轮收尾重跑，全绿）

- `pnpm lint` exit 0：`cargo fmt --check` + `cargo clippy -- -D warnings` + 7 条护栏（命令层 9 个文件、0 收口缺口）+ 170 条护栏自测 + java-host
- `pnpm lint:fe` exit 0：eslint 0 error、`tsc --noEmit` 无错、`vitest run --typecheck` **486 文件 / 4335 通过 / 2 跳过**、Type Errors none
- `cargo test`：**1361 passed（lib）+ 103 passed（integration）**，0 失败

## 仍未完成

Step 7.2 里需要眼睛的部分：Changes 面板可见性与闪现、10 次失焦聚焦、大仓冷启动时延观感。
AI 侧无法完成：这台机器的 `screencapture` 没有屏幕录制权限（`could not create image from display`），
而用户已安装的 `/Applications/Neeko.app` 与 dev 实例共用 `~/.neeko/`。
按用户要求**未提交代码**。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 236: Worktree 身份收尾：面板渲染级验证、连击与冷启动 P95 实测、手测夹具脚本

**Date**: 2026-09-28
**Task**: Worktree 身份收尾：面板渲染级验证、连击与冷启动 P95 实测、手测夹具脚本
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

# 会话：worktree 身份收尾 —— 面板渲染级、连击、冷启动 P95、20 次切换、手测夹具脚本

## 这一轮在做什么

前三轮把代码与门禁做完了，剩下 4 项 AC 挂着，原因是「需要眼睛」。这一轮的目标是
**把还能自动化的东西全部搬进自动化**，并把确实搬不动的那部分变成一条命令可复现的手测。

## 新增的验证（都是先红后绿）

- `GitCommitPanel.unit.test.tsx`（4 条，**渲染级**）：把 issue #2 的原始症状钉在真实渲染输出上 ——
  单元有权威快照 ⇒ 文件行真的出现；槽位缺失 ⇒ `Loading changes…` 且对面单元的条目不出现；
  快照为空 ⇒ 才是 `No changes`；主仓 ↔ worktree 交替 ⇒ 每格只含自己的行。
  它一开始根本跑不起来（缺 `AppProvider` 替身、缺 `getChangedFilesDiffStats` 等容器依赖），
  这本身就说明：这个容器此前没有任何渲染级覆盖，「列表看不见」没人守着。
- `useGitStatusEventsSync.test.ts`：聚焦/失焦 **10 次连击**专项（假计时器）。断言 10 轮后 worktree
  槽位仍只含自己条目、已卸载的主仓不被产出、也不出现「空串 worktreePath」开的第三格。
- `lifecycle_tests.rs`：`twenty_unit_switches_do_not_accumulate_mounts` —— 20 轮 main ↔ linked
  worktree 来回切，每轮断言挂载表只剩当前单元、回收数 ≤ 1，末轮清空。
- 冷启动**实测**（隔离 HOME，4 次真启动，被测仓库 = 本工作树 146 条未提交改动）：
  进程首行 → 首个快照 **820–850ms**；`Running git status` → emit **90–110ms**；entries 恒为 146
  与 `git status --porcelain` 一致。结论：身份链路只占 ~110ms，其余 ~700ms 是应用初始化。
  小仓同口径 21–30ms。

## 新交付物：`tools/worktree-handtest.sh`

Step 0.2 要求的「真实 linked worktree 手测夹具」现在是一条命令：独立 `HOME`、repo + 两个**同级**
linked worktree（嵌在主仓工作树里会污染「主仓应干净」这条判据）、每单元各自的脏改动、
session 里的激活单元**故意写成符号链接形态**，并打印真值命令与待人工确认的 4 项。
已端到端验证：主仓挂载 → `released unit` → 恢复出 `…\0/private/var/…/wt-a` 且 `entries=1` 与真值一致。

## 仍然开着（诚实记录）

AC4 / AC7 / AC12 的像素级观感与 AC13 的 WSL / SSH 逐项对比。这台机器对我关着两条观测通道：
`screencapture` 无屏幕录制权限、`osascript` 无辅助访问权限；仓库里也没有 Playwright/Puppeteer，
临时装一套浏览器驱动属于你没要求的环境变更，所以没做。AC13 还需真实 Windows/WSL 与真实 SSH 目标。

## 门禁（本轮收尾重跑）

`pnpm lint` exit 0 · `pnpm lint:fe` exit 0（eslint 0 error、tsc 无错、**487 文件 / 4340 通过 / 2 跳过**、
Type Errors none）· `pnpm type-check` exit 0 · `pnpm test:run` exit 0 · `cargo test`
**1362 passed（lib）+ 103 passed（integration）**，0 失败 · `cargo fmt --check` 与 `clippy -D warnings` 干净 ·
7 条护栏全过。**未提交任何代码**（HEAD 仍为 `1739cc70`）。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 237: Worktree 身份第五轮：挂载唯一入口与写后收口升级为护栏判据，并留下 AC13 的具体线索

**Date**: 2026-09-28
**Task**: Worktree 身份第五轮：挂载唯一入口与写后收口升级为护栏判据，并留下 AC13 的具体线索
**Branch**: `main`

### Summary

把「生产代码只有 activate 能挂载体」与「写命令必须收口」写成护栏第 4/5 类判据（+9 条自测，护栏自测共 169 条）；对抗性自查确认远端 status 的本地 assert_git_repo 属 HEAD 既有行为而非本次回归，并把这条线索写进 PRD 已知缺口以免 AC13 误判。pnpm lint 与 7 条护栏全绿，未提交代码。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 238: 修掉本任务引入的远端回归：仓库存在性判定交回 transport，远端激活改为收口+pull

**Date**: 2026-09-28
**Task**: 修掉本任务引入的远端回归：仓库存在性判定交回 transport，远端激活改为收口+pull
**Branch**: `main`

### Summary

删掉命令层默认挂载后，activate 与 status_porcelain 仍用本地 fs 判定 git 仓库，导致 WSL/SSH 单元 status 一律失败、Changes 面板永远 Loading（HEAD 走 transport 脚本，故属本次引入）。改为 transport.is_git_repo + 新增 supports_push_producer（只有 Local 有 push 生产者，远端激活=收口+立刻 pull），并补两条在旧代码上必红的测试。cargo test 1364 + 103、pnpm lint:fe 487 文件/4340 通过、7 条护栏与 clippy/fmt 全绿；未提交代码。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 239: Worktree 身份第六/七轮：远端两个自引入漏洞修好，AC4 编辑→推送 P95 机器出数，账面三处失真更正

**Date**: 2026-09-29
**Task**: Worktree 身份第六/七轮：远端两个自引入漏洞修好，AC4 编辑→推送 P95 机器出数，账面三处失真更正
**Branch**: `main`

### Summary

把本任务自己引入的两个远端漏洞改回来：仓库存在性判定交回 transport（新增 supports_push_producer，远端激活=释放挂载+立刻 pull），read_unit_status 改为「先问有没有生产者再信缓存」（否则未挂载单元的首次 pull 结果被永久当权威，违反 I1-b）。新增 #[ignore] 测量型测试采两类单元各 20 轮「写入→快照 version 前进」：linked worktree P95 57.1ms vs 主仓 56.8ms，差值在噪声内。修复 PRD 的半截句子、「未实测项」与 AC11 矛盾、护栏自测数 9→18。pnpm lint / type-check / test:run（487 文件 4340 通过）/ cargo test（1364+103）全绿；上一轮单条 FE 失败复跑不复现，判为负载抖动非回归。代码未提交。

### Main Changes

# 会话：worktree 身份第六/七轮 —— 远端两个漏洞、AC4 时延出数、账面修复

## 第六轮：自查抓到本任务自己引入的两个远端漏洞（都先红后绿）

1. **仓库存在性判定用错了主体**。删掉命令层的默认挂载后，远端项目只剩 `activate()` 一条路，
   而它与 `status_porcelain` 都用**本地** `is_git_repo` 判存在性 ⇒ WSL / SSH 单元 status 一律失败、
   Changes 面板永远 Loading。判据：HEAD 的远端走 `remote_git_info_command` 经 transport 现算，
   不受影响 ⇒ 确证是本次引入而非既有行为。改为 `transport.is_git_repo()`，并新增
   `supports_push_producer`（只有 `ExecTarget::Local` 有 push 生产者；远端激活 = 释放挂载 + 立刻 pull）。
   测试 `status_porcelain_uses_transport_repo_check_not_local_filesystem`（传一个本地绝对不存在的
   远端路径）与 `only_local_targets_get_a_push_producer` 在旧代码上必红。
2. **读接口的判序反了**。`read_unit_status` 先查缓存再看挂载 ⇒ 未挂载单元第一次 pull 的结果被
   永久当成权威返回，`refreshRepoStatus` 成空操作 —— 正是 I1-b 明令禁止的「旧数据伪装成事实」。
   改为「先问有没有生产者，再决定能不能信缓存」。该顺序依赖 `AppStateWrapper` 这个组合根，
   `cargo test` 里断言不了，规则与不可测原因一并写进 `.trellis/spec/backend/git-domain.md` §12。

## 第七轮：AC4 的现场时延项改成机器出数

新增 `#[ignore]` 的测量型测试 `lifecycle_tests::edit_to_push_latency_p95_worktree_vs_main`：
同一份 linked-worktree 夹具，两类单元各采 20 轮「`fs::write` 返回 → 该单元快照 version 前进」，
每轮都断言该次推送确实包含本轮新增文件（否则样本无法归因）。

- linked worktree 单元：p50 47.7ms / **p95 57.1ms** / max 57.1ms
- 主仓单元：p50 43.9ms / **p95 56.8ms** / max 56.8ms

差 0.3ms 在噪声内 ⇒ worktree 单元没有被特殊拖慢（两者共用同一条 notify → throttle →
`worker.check()` → `store_snapshot` → `emit` 链路）。默认 ignore 的理由：它测时序不测行为，
进 CI 只会抖动。`tools/worktree-handtest.sh` 的检查清单同步改成只核「列表真的跟着变」。

## 账面修复（这三处都是「文档说的和代码做的不一致」，比缺代码更坑）

- `prd.md` 尾部（AC4/AC7 之外的三条 AC 交付状态、决策 D-A/D-B/D-C 与 I1-a/I1-b、Notes）曾在一次
  脚本批量编辑里被切掉，按本会话已确认原文重建并**显式标注重建**；本轮又发现 AC11 条目里新旧两句
  拼在一起成了半截句子，合并重写，并把口径写明是**挂载表**而非 OS 线程数曲线。
- `prd.md`「未实测项」一条仍在说 AC11③ 大仓冷启动 P95 未测 —— 与同文件 AC11 条目矛盾，改为
  「未交付项（仅剩需要眼睛的现场）」并列出已出的两组时延数字。
- AC9 的护栏自测数 9 → 18（第五类判据「写命令收口 / 挂载单点」新增的自测没回写）；
  `implement.md` 里用例文件名更正为 `GitCommitPanel.unit.test.tsx`。

## 门禁（第七轮复跑，PRD 修复之后）

- `pnpm lint` exit 0：`cargo fmt --check` + `cargo clippy -- -D warnings` + 7 条护栏 / 169 自测
  （`check_repo_unit_identity` 扫 1373 文件 0 违规）+ java-host 22 项
- `pnpm type-check` exit 0；`pnpm test:run` 487 文件 / 4340 通过 / 2 skip；`pnpm lint:fe` Type Errors 0
- `cargo test` 1364 lib（+4 ignored）+ 103 integration 全绿
- 上一轮 `lint:fe` 的单条失败（`records usage and forwards variable-free prompts directly` 耗时
  178727ms、只收集到 479/487 文件）复跑不复现 ⇒ 判为机器负载抖动（该用例属 agent-prompt 模块，
  与本任务无关），不是回归

## 状态

代码未提交（用户要求「不要主动提交代码」，HEAD 仍为 `1739cc70`）。任务只剩需要人的眼睛的现场项：
implement.md 7.2 与 AC4/AC7/AC12 的观感确认（`bash tools/worktree-handtest.sh --run`），
AC13 需真实 WSL / SSH 环境。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 240: Worktree 身份第八轮：现场日志暴露 version 号段随释放归零，号段与快照数据分离修掉

**Date**: 2026-09-29
**Task**: Worktree 身份第八轮：现场日志暴露 version 号段随释放归零，号段与快照数据分离修掉
**Branch**: `main`

### Summary

用户现场确认手测通过后，回读他那次会话的 ~/.neeko/neeko.log 发现 13 次快照推送全是 v1 —— 取号源是槽位里那份快照，而 release 连槽位一起删 ⇒ 切项目 A→B→A 后第一份新快照被前端 version<=prev 判成旧的丢弃，界面停在离开时的旧数据（同 issue #2 原症状）。修法是把号段（version_floors）与快照数据分开存：release 只作废数据，号段仅在 unwatch_project 时随项目回收；取号与水位推进同一次持锁完成，并发生产者不会撞号。先红（remount_continues_the_unit_version_sequence 报「切回后的第一份是 1，而槽位里还留着切走前的 2」）后绿，并更正既有用例「重挂后 version==1 才算作废」的错误判据；前端补契约用例（不得加『重新挂载⇒号归零』特例）；手测夹具脚本补 A→B→A 专项。第八轮门禁：cargo test 1366+103、pnpm lint（7 护栏/169 自测）、test:run 487 文件/4341 通过、type-check、fmt、clippy 全绿。AC13 仍留开（本机无 WSL/SSH 项目）。代码未提交。

### Main Changes

# 会话：worktree 身份第八轮 —— 现场日志暴露「version 号段随释放归零」，先红后绿

## 用户现场核对通过后，读他的日志读出一个真缺陷

用户跑完手测并确认「手动验证没有问题了」。我回读那次会话自己的日志
（`~/.neeko/neeko.log`，09:16:40–09:20:50）做账面收口，看到 **13 次快照推送全是 `v1`**：

```
[GitWorker] Emitting snapshot v1 for /Users/tomgs/RustroverProjects/neeko (branch main): 147 entries
[GitWorker] Emitting snapshot v1 for …/.qoder/worktrees/agents-md-opt (branch worktree-agents-md-opt): 1 entries
```

每次挂载都从 1 起号 ⇒ `store_snapshot` 的取号源是**槽位里那份快照的 version**，而
`release_one` 把槽位条目一起删了。后果落在「切项目」这条路上（A→B→A）：这条路上没有任何人
作废 A 的前端槽位（`invalidateStatus` 只在 worktree 切换 / 删除 / 改名 / 挂载失败四处发），
切回后 worker 的第一份快照 `v1 <= prev v3` 被前端乱序闸门静默丢弃 ⇒ 界面继续显示离开时的
旧快照，要等 push 爬到 v4 才恢复 —— **与 issue #2 的原症状同形**。

为什么既有测试全都没抓到：它们一律只断言「同一挂载周期内单调」，跨挂载周期的号没人看过。
这类缺陷只有真跑一遍、并且把日志当证据读才会浮出来。

## 修法（号段与数据分离，不是给前端补特例）

- 新增 `WatcherManager::version_floors`：每单元历史最高水位，与 `snapshots` 分开存。
  `store_snapshot` 取号 = `max(水位, 槽位现有) + 1`，且取号与水位推进在**同一次持锁**里完成
  （两个生产者并发盖章不会撞号）。
- `release_one` 只作废数据，不作废号段；号段仅在**项目移除**时随 `unwatch_project` 回收，
  规模以「项目 × 该项目的单元数」为界（一个项目 = 主仓 1 + 每个 linked worktree 至多 1）。
- 前端保持严格闸门，**不加**「看着像新纪元的 v1 也放行」的特例 —— 那正是当初 pull 覆盖 push
  的入口。

## 红→绿

- `remount_continues_the_unit_version_sequence`：挂载 v1 → 编辑 v2 → 释放 → 重挂，断言新快照
  `> v2`。旧代码报「切回后的第一份是 1，而前端槽位里还留着切走前的 2」。
- `pull_after_a_release_still_continues_the_sequence`：push / pull 共用一条号段。旧代码报
  「挂载首轮快照要接在同一号段之后：1 <= 2」。
- 既有判据更正：`unwatch_drops_only_that_unit_snapshot` 原以「重挂后 `version == 1`」为
  「槽位已作废」的证据，与新单调性互斥 ⇒ 改为「新快照必须严格大于切走前的水位」（更强，
  残留槽位的号不可能变大）。
- 前端契约用例：`projectStore.test.ts`「切项目回来时槽位可能未作废：入槽只看号大小，没有
  『重新挂载 ⇒ 号归零』的特例」。

## 顺带的手测日志核对结论（可复核）

- 那次会话 **0 条 ERROR**、0 条 `already watched`、0 条 `not a git repository`、0 条 git 失败关键字。
- 被测的是 `src-tauri/target/debug/neeko`（`/Applications/Neeko.app` 里的二进制是 09-24 的旧版，
  且日志里没有旧载荷形态）⇒ 现场核对确实覆盖了本任务的代码。
- 项目里 `ssh` / `wsl` 关键字命中 0 次，且 11 个项目 `environment.type` 全是 `Local`
  ⇒ **AC13（WSL / SSH 不恶化）本机无从执行**，仍留开。
- 另记一条既有缺陷（非本次引入）：每次会话数百到数千条
  `[exec] collect_blocking_with called from within a runtime context (local/mod.rs:31:5)` ——
  diff-stats 路径每个变更文件一次 `wc -l`，在 async 上下文里调同步门面，门面为自愈每次另起一条
  OS 线程（红线 3 的反面）。同款 WARN 在本任务开工前的 09-24 / 09-25 滚动日志里已有 6517 / 4590 条。

## 门禁（第八轮）

`cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test` 1366 lib + 103 integration 全绿；
`pnpm lint`（7 条护栏 / 169 自测 + java-host 22 项）exit 0；`pnpm test:run` 与 `pnpm type-check` 见
同轮记录。代码仍未提交（用户要求「不要主动提交代码」，HEAD 为 `1739cc70`）。

## 状态

implement.md Step 0–8 全部勾选；PRD 的 AC1–AC12 已打勾（AC4/AC6/AC7/AC12 依用户现场结论），
**AC13 留开**：需要真实 WSL / SSH 项目。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 241: Worktree 身份 P1/P2 收尾 + spec 契约同步与迁移前路径清零

**Date**: 2026-09-29
**Task**: Worktree 身份 P1/P2 收尾 + spec 契约同步与迁移前路径清零
**Branch**: `main`

### Summary

三轮一笔：① 代码修 P1-1（远端路径不进宿主 PathBuf）/P1-2（ahead-behind 键收敛为 RepoKey）/P1-3（事件路径基准=单元工作树根）+ 顺带扫出的 git-changed 载荷静默死亡；② P2 同类清零（mount_only 原子化、current_branch 第二写者、单一派生点、死代码与夹具）；③ 文档把新不变量落档并把迁移前的 store/hook/目录/类型文件引用（约 100 处）清到零。门禁 7/7 护栏 + cargo test + tsc/vitest 全绿；AC13 仍需真实 WSL/SSH 现场；代码未提交。

### Main Changes

### A. 代码：P1-1 / P1-2 / P1-3（跨平台、双键、事件路径基准）

- **P1-1 远端路径不进宿主 PathBuf**（`common/git/path_guard.rs`）：`canonicalize_worktree_path`
  按 `ExecTarget` 分叉 —— Local 用 `PathBuf` 词法归一，WSL / SSH 改走纯字符串
  `lexical_normalize_posix`。旧实现下 Windows 宿主会把 `/home/u/p` 归一成 `\home\u\p`，两层后果：
  ① 身份 key 跨宿主分叉（同一远端单元在 Windows / macOS 算出两个 key）；② WSL 执行器是
  `cd <dir> && exec …`，`cd \home\u\p` 必失败 ⇒ Windows 宿主上 WSL/SSH 项目的 changes 直接瘫痪。
  回归钉子 `remote_posix_path_is_never_rewritten_with_host_separators`（SSH / WSL 两个 target，
  纯字符串断言、与宿主 OS 无关）。`repo_ref.rs` 的两条 golden 用例随之恢复平台无关。

- **P1-2 ahead/behind 只剩一种键**：键 = `RepoKey`（仓库单元身份），删除
  `shared/utils/aheadBehindKey.ts`（连带删掉只为拼这个键而存在的 `useRefreshGitInfo`
  `connectionContext` 参数）。根因不是「双键」而是**四种键约定**：写侧
  `{kind}:{distro|host}:{unit}` 与 `{kind}:{host}:{port}:{projectId}`，读侧 `local:{projectId}`
  与裸 `aheadBehind[projectId]` —— 读侧永远拼不出写侧的键，于是 `BranchStatusBarWidget` 徽标恒空、
  主仓行显示的是**激活单元**的数字。`project.id` 本身是 UUID，`RepoKey` 已全局唯一 ⇒
  `{source}:{connectionId}` 维度纯冗余。写侧 4 处统一（`useRefreshGitInfo` /
  `useLocalProjects` / `useGitStatusEventsSync` / `useAheadBehindSync`），读侧 4 处统一
  （`GitControlPanelWrapper` / `ProjectGitSection` / `BranchStatusBarWidget` /
  `ConnectionProjectCard`）；新增 `BranchStatusBarWidget.test.tsx`（**读侧此前完全没有测试**，
  恒空 bug 因此长期无人发现）。

- **P1-3 事件路径基准 = 单元工作树根**：新增 `unitWorkDir(repoKey, projectRoot)`（与 Rust
  `RepoRef::work_dir()` 同义：主仓回落项目登记路径，linked worktree 用后端回传的 canonical 路径）。
  三个未跟改造的消费点改用它 —— `HtmlPreview.tsx` / `useBrowserPanelEvents.ts` /
  `useBrowserTab.ts`；`useUntrackedDirExpansion` 补必填 `repoKey` + 同址过滤（跨单元事件不得驱动
  本列表重拉）。
  顺带扫出**同类 P1**：`git-changed` 载荷已从裸 `project_id` 改成
  `GitChangedEvent{repo_key, project_id}`，但两个浏览器消费点仍是 `useTauriEvent<string>` +
  `payload !== projectId` ⇒ 对象 ≠ 字符串恒早返回 ⇒ **整条通道静默死亡**（不报错、不留痕），
  且它们的测试用裸字符串发事件，所以一直是绿的 —— 夹具跟着代码一起没跟契约。已修 + 夹具同步。
  未改：`git/components/diff/useDiffData.ts` 仍只按 `project_id` 匹配（两侧都是单元相对，跨单元
  只会多一次幂等重取，后端按指纹命中缓存，不会显示错误数据）。

### B. 代码：P2 同类清零

| 项 | 处理 |
| --- | --- |
| 挂载不变量原子化 | 新增 `WatcherManager::mount_only(repo, sink)`：`release_except` + `watch` 在**同一临界区**（`mount_lock: Arc<Mutex<()>>`），内部走无锁内核 `release_except_inner` 避免自死锁；`activate()` 改调它。旧写法两步各自加锁，并发 `activate`（快速切项目 / 连点）可交错成 `c1.release, c2.release, c1.watch, c2.watch` ⇒ 两套挂载常驻。+2 条并发用例（2 线程布障挂不同单元 ⇒ 恰好一套；4 线程挂同单元 ⇒ 只建一套 watcher），临时去掉锁后 3/3 次稳定变红 |
| `current_branch` 第二写者 | `useLocalProjects.handleRefreshGit` 不再写（唯一写者 = `applyStatus` 的主仓投影）。该用例原本标题写着「worktree 刷新**不得**改写主仓分支名」而断言在钉旧行为，一并改写为真判据 |
| 当前单元 key 单一派生点 | 新增 `selectActiveRepoKey(state, projectId)` / `activeRepoKeyOf(projectId?)`（`worktreeStore.ts`），收敛原 6 处手写的 `repoKeyOf(pid, byProject[pid]?.activePath ?? null)`；护栏新增「直读 `.byProject[...].activePath` 即违规」判据 + 2 条自测；`ProjectGitSection` 的渲染期 `getState()` 改响应式 selector |
| 死代码 | 删 `common/git/remote.rs` 整文件（`get_remote_git_info` 无调用者 + 仅它用的采集脚本）、`parse_git_info_output`（102 行）、`WatcherManager::unwatch_unit`（与 `release_one` 逐行重复）；前端删 `getActiveWorktreeBranch` / `useOpenedWorktrees` / `replaceAll` / `selectWorktrees` / `setStatusVersion`（最后一个原本只是「测试注入点」却挂在生产接口上，测试改用 `setState` 铺陈旧基线）|
| 夹具残留 | `ProjectItem.test.tsx` / `ProjectGitMenu.test.tsx` 去掉已删的 `changed_files` / `is_clean`（`...overrides` 展开抑制了 tsc 的多余属性检查，所以此前一直绿着）|

**不动的一点**：`operations/info.rs` 的 `worktrees.remove(0)` **保留** —— 先实证了
`git worktree list` 保证主工作树排在最前（git 2.54 实测 3/3 + git-worktree(1) 文档），
改成「按路径字符串过滤」反而对路径形态敏感（正是 P1-1 那类别名问题）。

### C. 文档：本次改动引入的契约落档

- `backend/git-domain.md` §12：补 ① 远端路径纯字符串归一（两层后果 + 「判据必须与宿主 OS 无关」）；
  ② `mount_only` 原子性（「不变量属于资源所有者」）；测试清单同步。
- `backend/concurrency-guidelines.md`：幂等粒度 project → `RepoRef::key()`；新增「挂载临界区
  原子化」契约 + Wrong/Correct 对；线程模型标题改为「每个已挂载仓库单元」，补 git 单元另加
  status worker / git-meta 监听。
- `frontend/state-management.md`：新增场景第 7/8/9 条（ahead/behind 键 = `RepoKey` + 四种键约定
  的漂移史、激活单元 key 单一派生点、事件路径基准 = 单元工作树根 + **载荷形状本身是契约**）；
  旧「跨域共用切片 + 复合 key 2026-05-18」场景标记为被取代并改写；「Project/File 单源化迁移」
  场景按域 store 重写；架构图与状态分类段重画。
- `frontend/api-layer.md`：事件表补 `git-status-snapshot` / `file-changed` / `file-tree-changed`，
  `git-changed` 载荷从 `string (projectId)` 修正为 `GitChangedEvent{repo_key, project_id}`；
  `listen<string>` 示例换成 `useTauriEvent` + 单一常量源，并写明裸写法在载荷演进时静默死亡。
- `frontend/hook-guidelines.md`：「现有 Hooks 参考」两张表**逐行核验重建**（删 6 个已删 hook、
  补落点列）；`useAheadBehindSync` 小节按现状重写（旧版写的是三域三 effect + `useAppStore`）。
- `src/AGENTS.md`：状态管理原则新增第 4 条「同一事实只有一个表示 / 派生点」，指向
  `state-management.md` 新场景。

### D. 文档：迁移前符号与路径清零（约 100 处）

类别 = 「spec 指向已不存在的 store / hook / 目录 / 类型文件」。先写机械扫描器（抽出 spec 内所有
`` `src/...` `` / `` `src-tauri/...` `` 路径逐个验存在性，排除带「旧 / 已删除 / →」的历史行）拿到
权威清单，再逐条核实现状后清：

| 旧 | 现 |
| --- | --- |
| `useAppStore`（单一 store，27 处） | 域 store：`projectStore` / `worktreeStore` / `editorStore` / `dockStore` / `appViewStore` / `gitStore` / `connectionStore` + feature store（`@/features/file/store`、`@/features/skill/store`）|
| `useSyncToStore` / `useAppContainer` | `useAppStoreSync` / `useAppShell`（= `useAppGlobalEffects` + `useAppShellData` + `buildAppShellValues`）|
| `src/store|hooks|context|contexts/` | `src/shared/{store,hooks,contexts}/` 或 `src/features/<domain>/…` |
| `src/types.ts` / `src-tauri/src/state.rs` | `src/shared/types/<domain>.ts` / `common/types.rs` + 各域 `*/types.rs` + `core/project.rs` |
| `src/components/**` | `features/*/components/`（真正被多 feature 共用的在 `shared/components/`）|
| `src/tailwind.css` | `src/styles/index.css`（只聚合）+ `tokens/*` 的 `@theme` + `components/*.css` |
| `src/test/setup.ts`、`src/tests/` | `src/testing/setup.ts`；测试文件**同层** `__tests__/`（引 `vitest.config.ts` 的 `include`）|
| `src-tauri/src/{commands,storage.rs,models/}`、`skill/` | `session/commands.rs` / `session/manager.rs` / `session/types.rs` / `library/` |
| `git/{commands,local,remote,wsl,operations,pr}.rs` | `git/commands/`（按主题分文件）+ `git/services/` + `common/git/` |
| `crate::opencode_theme` / `crate::pi_theme` | `crate::theme::opencode` / `crate::theme::pi` |
| 已删符号：`RemoteItems.tsx`、`RemoteProjectView.tsx`、`AppLayout`、`SkillContext`、`useLsp`/`useLspDiagnostics`/`useLspHover`/`useLspCompletion`、`useSideTerminalResize`、`WSLItem`/`RemoteItem`、`fileTabs`/`activeFileTabId`/`fileTree`/`fileViewLoading` | 换成现存对应物，或按「已删除 / 原…时代」显式标注 |
| 已退役字段 `is_clean` / `changed_files` | `branches` / `worktrees` / `truncated` / `git_provider` |

另修掉自己上一轮写错的一处：`cross-layer-thinking-guide.md` 把「内存 `Project`」指向了
`src-tauri/src/project/types.rs`（那其实是 2 行 `pub use` barrel），真身是
`src-tauri/src/core/project.rs`。

**扫尾结果**：路径扫描器 MISS 30 → **8**，剩余 8 条全是显式历史 / 条件引用
（`src-tauri/.rustfmt.toml`「如存在」、`src/adapters` 的 2026-05-06 变更记录，以及 5 处我写的
「旧 → 新」对照行）；裸名复扫剩余 `state.rs` 4 处全是「**没有 / 不再有** `state.rs`」的声明。

### E. 门禁（三轮各自跑过，下面是终态）

- `python3 tools/guards/run.py run`：**7/7 通过、0 违规**（`check_repo_unit_identity` 1371 文件
  0 违规；护栏自测 169 → 173；`check_agents_md_size` 通过）。
- `cargo fmt --all -- --check` / `cargo clippy -- -D warnings`：0 / 0。
- `cargo test`：lib **1360 passed / 4 ignored**；integration **103 passed**。
- `npx tsc --noEmit` / `npx vitest run --typecheck`：0 error / **489 files、4360 passed、2 skipped、
  Type Errors: none**。
- `npx eslint src/`：0 error（仅 1 条既存 VirtualList warning）。
- 文本完整性：改动文件无 NUL / 非法 UTF-8 / ESC；`HtmlPreview.tsx`（9）、`useFileView.ts`（6）、
  `ProjectGitSection.tsx`（8）的 U+FFFD 与 HEAD **逐数一致 = 既存**，非本次引入；
  所有改动 `.md` 代码围栏偶数配对。

### F. 如实说明与留开项

- **AC13 仍未执行**：需真实 WSL / SSH 现场（本机 11 个项目 `environment.type` 全是 `Local`）。
  P1-1 是 Windows-only 缺陷，本机（macOS）造不出旧实现的红 —— 与红线 13 自己写的
  「唯一可靠判定是 CI 的 Windows `cargo test` job」一致；结构性保险是远端分支已不可能再拿到
  `PathBuf`。
- 3 个文件的**既存 U+FFFD 乱码**保持不动（猜原文比重写更危险），留给单独一轮决定。
- **新发现（代码，本次只记档未改）**：
  1. **类型双份定义**：`session/types.rs` 与 `session/model.rs` 各完整定义一份
     `ProjectSession` / `WSLProjectSession` / `RemoteProjectSession` / `SessionStore`
     （`model.rs` 头注写着 "alternate module path"）；`common/connection/types.rs` 与
     `model.rs` 同样各定义一份 `AuthMethod`。已在 cross-layer guide 对照表标注「⚠️ 待收敛」，
     收敛本身涉及 40+ 处 import 归口，应单独一轮。
  2. `useDiffData` 的跨单元**幂等重取**（无害，未收口）。
- 代码**未提交**：`git diff --cached` 为空，改动全部未暂存，HEAD 仍为 `1739cc70` —— 按用户要求
  不由 AI 提交。

### Git Commits

（**未提交** —— `git diff --cached` 为空、改动全部未暂存，HEAD 仍为 `1739cc70`；
用户要求「不要主动提交代码」，故本会话不代提交）

### Testing

- [OK] 护栏：`python3 tools/guards/run.py run` → **7/7 通过 / 0 违规 / 0 护栏失效**，自测 173 tests OK（169 → 173）
- [OK] `cargo fmt --all -- --check` → OK；`cargo clippy -- -D warnings` → 0
- [OK] `cargo test` → lib **1360 passed / 4 ignored**；integration **103 passed**
- [OK] `npx tsc --noEmit` → 0 error；`npx vitest run --typecheck` → 489 files / **4360 passed** / 2 skipped / Type Errors: none
- [OK] `npx eslint src/` → 0 error（1 条既存 VirtualList warning）
- [OK] 红→绿逐类验证：P1-3 三类（HtmlPreview 基准 / useUntrackedDirExpansion 同址过滤 / 浏览器载荷形状）临时回退变红；P2-4 去掉 `mount_lock` 后并发用例 3/3 次稳定红；P2-5 恢复旧写者后变红；P1-1 与 P1-2 为 Windows-only / 恒空类缺陷，本机造不出旧红，已如实说明判据边界
- [OK] 文本完整性：所有改动文件无 NUL / 非法 UTF-8 / ESC；3 个文件的 U+FFFD 与 HEAD 逐数一致（既存）；改动 `.md` 围栏全部偶数配对

### Status

[OK] **Completed**（代码 P1/P2 + spec 契约同步 + 迁移前路径清零三轮全部完成）

### Next Steps

- **AC13**：需真实 WSL / SSH 项目现场（本机 11 个项目全为 `Local`）；并关注 **Windows CI 的 `cargo test`** —— P1-1 的红→绿只在 Windows 成立
- **类型双份定义收敛**：`session/{types,model}.rs` 与 `common/connection/{types,model}.rs` 各有一份同名类型，需归口
- **既存 U+FFFD 乱码**：`HtmlPreview.tsx`(9) / `useFileView.ts`(6) / `ProjectGitSection.tsx`(8) 待单独一轮核对原文
- `useDiffData` 跨单元幂等重取（无害，可选收口）
- 用户提交这批改动（AI 不代提交）


## Session 242: 挂载收敛判据拆分：修 pull 槽位误判与 already-watched 告警，判据/机制分层落文档

**Date**: 2026-09-30
**Task**: 挂载收敛判据拆分：修 pull 槽位误判与 already-watched 告警，判据/机制分层落文档
**Branch**: `main`

### Summary

一笔收口：把 useActiveRepoUnitSync 压成一个 hasSnapshot 的判断拆成两个判据（请求挂载按意图边沿、是否重试才按槽位为空），修掉「pull 读预填槽位被当成后端已挂载」导致切项目/冷启动不挂载、以及「失败后改 ref 不重跑 effect」导致永久 Loading changes 两条同源症状；同时把 mount_only 的幂等性提到资源所有者层（回正 already watched 告警语义）、新增 repoKeyLabel 修掉 RepoKey 入日志带 NUL 的问题、删掉仅供测试的 peek；spec 规则 6/8 按「判据留、机制让位」重写。门禁：cargo fmt/clippy 通过、cargo test --lib 1367 passed、pnpm lint:fe 4383 passed、guards 7/7 零违规；代码未提交。

### Main Changes

### A. 根因（第一性原理）

前端**没有**「后端此刻挂着哪个单元」的可观测面，唯一合法的替代证据是**自己的请求历史**。而
`useActiveRepoUnitSync` 把「槽位非空」当成了「后端已挂载」。槽位是**数据面** ——
`useSessionBootstrap` 启动时对每个 git 项目的主仓单元各做一次 pull 读并写槽位，而 pull 不建立
push 生产者。两个判据（*要不要请求挂载* / *要不要重试*）被压成一个 `hasSnapshot`，于是两类症状同源：

1. **该挂载时不挂载**：冷启动竞态与「切到该项目」都会跳过 `set_active_repo_unit` ⇒ 该单元没有
   watcher，Changes 冻结在那一刻（文件树着色、侧栏徽标一并静止）—— 正是本任务系列要根治的形态；
2. **该重试时不重试**：「失败后只把一个 ref 置回 null」，而 ref 不参与渲染 ⇒ 没有任何东西会再
   发起一次，永久停在 `Loading changes…`。

### B. 代码

- `app/hooks/useActiveRepoUnitSync.ts`：判据拆分 —— *请求挂载*按**意图边沿**（`requestedIntent`），
  *是否重试*才按槽位为空；重试驱动由 `then` 改为 `finally`（一轮的结束与结局无关，不建立在
  「callee 永不 reject」这条只写在注释里的契约上；万一契约被改坏，rejection 仍经全局
  `unhandledrejection` 进 `neeko.log`，不会被吞）；预算耗尽时只上报一次 `logFrontendError`（不弹
  toast）。docstring 写明**所依赖的前提**（后端释放当前单元必须在前端可观察：换意图或作废槽位，
  否则要给后端可查询的挂载状态，而不是再加前端启发式）与实例级记账带来的幂等重挂载下界。
- `shared/store/worktreeStore.ts`：新增 `useActiveRepoKey(projectId)`（复用 `selectActiveRepoKey`），
  消除 hook 里手写 `repoKeyOf(activeProjectId ?? '', …)` 这**第二处**身份派生 —— 且无项目时会产出
  `'\u0000'` 这种谁也匹配不上的键。
- `shared/utils/repoRef.ts`：新增 `repoKeyLabel`（`p1 (main)` / `p1 → /wt/a`），形态刻意与 key 不像
  （护栏只拦 `:` / `|` 形态的手拼 key，对展示形态没有约束力，防误用只能靠形态自证 + 文档禁令）。
  修掉 `String(RepoKey)` 入日志把 NUL 分隔符带进日志文件的问题（实测一次失败日志就让 vitest 输出被
  `file(1)` 判成 `data`）；3 个站点复用：`useActivateRepoUnit` / `gitStatus` / 本 hook 的放弃上报。
- `common/file/watcher/manager/core.rs`：`mount_only` **自身幂等**（已挂载则不转调 `watch`）。
  重申挂载（前端重试、激活态被改写成 canonical 形态后的一次重发）是合法路径，不该命中 `watch` 的
  「重复注册」告警分支 —— 那条 WARN 的语义是「有人绕过了唯一挂载入口」，AC12 的现场核对正以
  「0 条 already watched」为证据，被合法路径触发等于把告警作废。
- `shared/utils/retryBudget.ts`：删除仅供测试观测的 `peek()`；契约文档写清 `acquire` / `release`
  的非对称语义（后者只用于「已收敛」或「请求根本没发出去」）。
- `.trellis/spec/frontend/state-management.md`：规则 6 改为「请求挂载 / 重试」两条判据 + 各自的
  **禁止形态**，机制叙事让位给 hook docstring（本规则只留判据与禁令），保留墙钟上界（约 8s）与
  耗尽后的恢复条件；规则 8 补上 `useActiveRepoKey` 这第三种合法派生形态。

### C. 测试（先红后绿）

- 新回归用例 2 条，对改前版本**红**（`expected +0 to be 1`）：① 槽位已被 pull 预填时仍必须请求挂载；
  ② 切到「主仓槽位已被 pull 预填」的项目必须为新单元挂载。
- 新增：退避窗内快照到达 ⇒ 取消本轮重试、耗尽后 `≤ maxAttempts` 且槽位保持「未知」+ 放弃上报恰好
  一次且不含 NUL、意图变化 ⇒ 预算归零、非 git 项目零命令、`mount_only` 重申是空操作（Rust）、
  `useActiveRepoKey`（store）、`repoKeyLabel`（纯函数）。
- 夹具改为小步推进虚拟时钟，不再把断言钉死在策略的具体毫秒值上。

### D. 门禁

`cargo fmt --check` / `cargo clippy -D warnings` 通过；`cargo test --lib` **1367 passed / 0 failed**；
`pnpm lint:fe` **490 files / 4383 passed**（Type Errors 无）；`tools/guards run` **7/7 通过 / 0 违规**。

### E. 状态与遗留

- 代码已按三条提交落地（拆分即下方建议）：`b5a2db18` 前端判据拆分 + 身份派生 + 日志 → `1de42d36`
  `mount_only` 幂等（含 Rust 测试）→ `e2d8ab9c` spec 规则 6/8 订正；本条会话记录另以
  `chore: record journal` 提交。三条提交的 pre-commit 钩子均未绕过（前端链路 117s、Rust 链路
  4.6s（含 java-host）、纯文档那次按各护栏 scope 跳过），commitlint 全过。
- `neeko-check` 13 维中第 12 条（`serde(default)`）与第 13 条（tauri-specta `bindings.ts`）与本仓既有
  决策冲突：D-C 明令禁止 snapshot 载荷加 `serde(default)`，本仓也无 specta（用 `shared/types` +
  双端 golden 测试对齐）。建议在规范里标注豁免并指向落点，避免每次审查重新争论。


### Git Commits

| Hash | Message |
|------|---------|
| `b5a2db18` | (see git log) |
| `1de42d36` | (see git log) |
| `e2d8ab9c` | (see git log) |

### Testing

- [OK] 护栏：`python3 tools/guards/run.py run` → **7/7 通过 / 0 违规 / 0 护栏失效**（框架自测 183 tests OK）
- [OK] `cargo fmt --all -- --check` → OK；`cargo clippy -- -D warnings` → 0；`cargo test --lib` → **1367 passed / 4 ignored**
- [OK] `npx tsc --noEmit` → 0 error；`pnpm lint:fe`（eslint + tsc + vitest --typecheck）→ 490 files / **4383 passed** / 1 skipped / Type Errors: none；`npx eslint <改动文件>` → 0 error
- [OK] 红→绿：2 条新回归用例对改前版本红（`expected +0 to be 1` —— ① 槽位已被 pull 预填仍须请求挂载 ② 切到「主仓槽位已被 pull 预填」的项目仍须为新单元挂载），改后绿；其余新增用例（退避窗内快照到达即取消重试、耗尽 `≤ maxAttempts` 且槽位保持未知、放弃上报恰好一次且不含 NUL、意图变化预算归零、非 git 项目零命令、`mount_only` 重申是空操作）覆盖各自分支
- [OK] 文本完整性：15 个改动/新增文件 `file(1)` 全为 Unicode/UTF-8 text（无 `data`）；NUL 字节扫描为空；U+FFFD 计数 0。本次修复的正是「`String(RepoKey)` 入日志把 NUL 带进日志文件」，测试输出侧实测由 `data` 变回 text

### Status

[OK] **Completed**（判据拆分 + 幂等下沉 + 日志 NUL + spec 分层四件事齐，并按三条提交落地）

### Next Steps

- 提交拆分已执行（见 Git Commits 与 E 节）；工作树在本次记录提交后应无残留改动
- `neeko-check` 规范第 12 条（`serde(default)`）与第 13 条（tauri-specta `bindings.ts`）与本仓既有决策冲突，建议在规范里标注豁免并指向落点（D-C 禁 snapshot 载荷加 `serde(default)`；本仓无 specta，用 `shared/types` + 双端 golden 对齐）


## Session 243: 门禁分层与脚本命名收敛：lint 只静态、test 只动态、check 聚合

**Date**: 2026-09-30
**Task**: 门禁分层与脚本命名收敛：lint 只静态、test 只动态、check 聚合
**Branch**: `main`

### Summary

commit 档只做静态（eslint --cache + tsc + fmt + clippy + 护栏），push 档才跑两套单元测试；脚本名收敛为 lint*/test*/check* 三层，新增 check_script_references 护栏钉住引用

### Main Changes

本次会话从「commit 只做 lint、push 才做 test 是否合理」这一问题开始，最终收敛为一次门禁分层 +
脚本命名的整理。工作区里原本已有一版未提交的分档改动（`lint:fe:static` + 新增 pre-push），先作为基线提交。

### A. 判定（先说判据）

- 阶段边界按**延迟预算**划，不按语言划：commit 是静态检查（暖缓存 ~10s），push 是两套单元测试
  （前端 ~50s、Rust ~3min），CI 是三平台终审。本地 hook 是**建议性**的，权威门禁是 CI。
- 「commit 档很快」在原实现下**不成立**：`eslint src/` 无缓存 61s（`--cache` 后 1.4s）。这是最该先修的
  一项 —— 本仓 guards 的 `budget_ms` 注释写过「慢到没人愿意跑的门禁等价于从门禁里消失」，
  而 lefthook 层此前恰好在违反它自己的原则（61s 的提交会把人逼向 `--no-verify`，一按就同时废掉
  commitlint 与全部护栏）。
- 「`test`=watch 会让 CI 挂起」经实测不成立：CI / 非交互（管道、重定向 stdin）会自动降级为 run 模式，
  只有**真终端**才 watch —— 而从终端执行 `git commit` 时 hook 继承 TTY，所以这个改动仍值得做，
  但定级是「防误用」而非「修故障」。
- 顺带纠正两处事实：`npx tsc` 优先用本地 bin（不会下载另一个 tsc）；lefthook 的 `**/` 要求至少一层
  目录，所以 `src/**/*.ts` 从来匹配不到 `src/` 的直接子文件。

### B. 命名收敛（终态 20 条脚本）

`lint*` 只做静态、`test*` 只做动态、`check*` 做聚合，后缀表达作用域：

- `lint` = 全部静态（`lint:fe` + `lint:rust` + guards）；`lint:fe` = eslint + tsc；
  `lint:fix` = eslint 写回；`type-check` 独立可调；`guards` 有子命令（同 `tauri`）不参与该语法。
- `test` = `vitest run`（新增 `test:watch`）；`test:rust` / `test:host` 与前端对称。
- `check:fe` / `check:rust` / `check` = 聚合，`check` 成为「最小回归集」单点（此前是 4 条命令被抄进
  AGENTS.md 与两份 CONTRIBUTING）。
- 删除 `lint:fe:static` / `lint:all` / `lint:host` / `test:run`。

### C. 落地顺序（每步一个提交，旧名先留、调用方先切、语义后改）

1. `28da4037` 基线：工作区既有的分档改动 + CI 补 eslint / fmt（门的强度不再取决于谁装了钩子）。
2. `059a1e03` 纯新增：`lint:rust` / `test:rust` / `test:host` / `lint:fix`；`type-check` 去 `npx`；
   `build` 显式 `--noEmit`；`lint:fe:static` 加 `--cache`（旧名全在，中间态全绿）。
3. `4a4b54de` 调用方切换：lefthook 与 CI 改调脚本名 → 顺带消灭「guards 与 java-host 每次提交跑两遍」
   （旧的 `pnpm lint` 里还套了一遍 `guards --stage local` 与 `lint:host`，且口径不同）；
   glob 扩到配置 / 锁文件 / `build.rs`，并修掉 `**/` 不匹配直接子文件的既有缺陷。
4. `526abb72` 语义重定义 + 删别名：`lint` 变全量静态、`test` 变 run-once、新增 `check*`。
5. `bbb9df7a` 文档同步：AGENTS.md、两份 CONTRIBUTING、PR 模板、BRANCH_PROTECTION、
   `.trellis/spec` 4 个文件、`docs/neeko-development-spec.md`（删掉已被本次改动实现的反向建议）。
6. `7e391c5c` 新增护栏 `check_script_references`：hook / CI / 文档里的 `pnpm <script>` 必须存在。
7. `0a80dc24` 记录 `packages/dsh-neeko` 的门禁豁免与加入配方。

### D. 实测（本机 / 2026-09-30）

| 检查 | 结果 | 耗时 |
| --- | --- | --- |
| `pnpm lint:fe`（eslint --cache + tsc） | exit 0 | 61s 冷 → **5.9s 暖** |
| `pnpm lint:rust`（fmt + clippy） | exit 0 | 1.7s 暖（59s 仅一次：探针改过 Cargo.toml mtime） |
| `pnpm lint`（全部静态 + 8 条护栏） | exit 0 | 10.4s |
| `pnpm test` | 492 文件 / 4418 通过 / 1 skip | 47.9s |
| `pnpm test:rust` | 1367 + 103 通过 | ~3min |
| `pnpm test:host` | Java 自检 OK（真跑，非跳过） | 数秒 |
| `pnpm check`（全量） | exit 0 | 276.8s |
| 护栏框架 | 8/8 通过 / 192 用例 | 0.4s |

glob 选择用**探针矩阵**验证（11 种文件形态 × 两个 hook），并用「改成不可能匹配的 glob」做反证；
pre-push 的真实文件集是 `git diff --name-only HEAD @{push}`（29 文件、`src-tauri/` 0 个 ⇒ rust-tests
正确跳过）。真 push 用临时本地裸仓库验证（真 hook + 真测试，47.9s 通过），探针与临时 remote 已清理。

### E. 残留风险与遗留

- **CI 未实跑**：两个 Rust job 新增了 `pnpm/action-setup` + `setup-node`（脚本名调用需要 pnpm），
  本地无法验证，需下一次 PR 确认；`cargo check` 保持原始步骤（平台矩阵专用，无脚本名）。
- `temp_spec.md` 是 `state-management` spec 的陈旧副本（仓库根、被跟踪），本次只同步了它的两条命令；
  建议单独删除。
- `.claude/settings.local.json`（本地未跟踪）里仍有 `pnpm test:run *` / `pnpm lint:fe` 的权限条目，
  下次会触发一次授权提示，可按需更新。
- `bundle` 未动、未推送 origin；工作树在本次 journal 提交后无残留。


### Git Commits

| Hash | Message |
|------|---------|
| `28da4037` | (see git log) |
| `059a1e03` | (see git log) |
| `4a4b54de` | (see git log) |
| `526abb72` | (see git log) |
| `bbb9df7a` | (see git log) |
| `7e391c5c` | (see git log) |
| `0a80dc24` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 244: 覆盖率门禁落地与测试环境边界收口

**Date**: 2026-10-01
**Task**: 覆盖率门禁落地与测试环境边界收口
**Branch**: `main`

### Summary

test 家族语义补齐（裸 test = 三套）；前端与 Rust 覆盖率成为 CI 门禁（修正被门禁漏掉的 useFileEditorLsp pin 漂移，Rust 首测 61.75% → 地板 60）；用文件级定时器取消替代与 jsdom 拆除竞态，根治弹层测试的随机红

### Main Changes

这是「门禁分层与脚本命名收敛」的后续收尾：把 `test` 家族的语义补齐、把两套覆盖率从"装饰性地板"
变成真门禁、并解决测试环境边界上的一个随机红问题。上一轮记录（session 243）止于 `0a80dc24`，
本条覆盖其后的 6 笔提交。

### A. 清理陈旧副本（`c9aa42da`）

`temp_spec.md`（仓库根、被跟踪）是 `.trellis/spec/frontend/state-management.md` 重构前（`useAppContainer`
/ `useSyncToStore` / `useWslProjects` 时代）的 316 行快照，live spec 已 1405 行且明确标注这些符号被取代。
全仓无引用。留着等于对同一问题给出第二份互相矛盾的答案 —— 删除。

### B. `test` 家族语义补齐（`6ff147a6`）

上一轮把裸 `lint` 定义成"全部静态"之后，裸 `test` 仍只跑前端 → **改完 Rust 敲 `pnpm test` 会拿到
"绿"的假象**（与当初修 `lint` 的理由同构）。补齐后：

```
test = test:fe + test:rust + test:host      test:fe = vitest run
test:fe:watch / test:fe:coverage            test:rust / test:host
check = lint && test                        check:fe = lint:fe && test:fe
```

`check:fe` 必须同改（否则它会从"前端"悄悄升级成"全量"）；`lefthook` 的 pre-push 前端那条与 CI 的
frontend-test job 改调 `test:fe`（用裸名会把 Rust 与 host 各跑第二遍）。**改名+调用方+文档必须同
一个 diff** —— 新护栏 `check_script_references` 是全量扫描，分两步提交必然卡在钩子上。BREAKING：
`pnpm test` 现在跑三套（~4 分钟）。

### C. 两套覆盖率从"地板"变"门禁"

- **前端（`e874e9ae`）**：`vitest.config.ts` 里的地板（全局回归底线 + per-file pin）此前**没有任何
  调用方**，第一次真跑就发现 pin 已漂：`useFileEditorLsp.ts` 实测 91.66% lines / 80% functions 对
  100% pin —— 组合冒烟测试刻意 stub 掉 `lspQuickFix`（只验证接线），于是 `getLanguageId` 这条
  quickfix 路径恒未覆盖。补 `useFileEditorLsp.test.ts`（renderHook，两臂：有 uri → 语言 id，无 uri
  → null）后地板恢复；`frontend-test` job 改跑 `test:fe:coverage`，覆盖率成为 CI 门禁（本地 hook
  仍不跑，守延迟预算）。
- **Rust（`280cdaea`）**：此前只有行为式要求（纯函数 100% / Manager 核心路径 100%），没有可测量
  地板。先量后钉：`cargo llvm-cov` 实测 lines **61.75%** / regions 64.29% / functions 57.89%
  （`theme/*` 与多数薄 `#[tauri::command]` 层为 0%，需要 Tauri 运行时），地板取 **60**（余量 1.75pt，
  与前端同理，只防回退）。新增 `backend-coverage` job：仅 ubuntu、仅当 PR 动了 `src-tauri/**` 或
  `package.json`；**job 常驻、只把重活条件化**（required check 被 job 级 `if` 跳过会永远 pending，
  卡死合并）；不挂 rust-cache（插桩产物 5.3GB，仓库缓存预算 10GB，会挤掉另外 6 个 job）。

### D. 测试环境边界收口（`c6dd50ab` + `c1714418`）

**症状**：所有用例通过、整轮 vitest 判红（`Unhandled Errors`：`Failed to execute 'dispatchEvent' …
parameter 1 is not of type 'Event'`），一轮红一轮绿（实测约 1/6 轮，报错来源指向
`McpTagGroupDialog.test.tsx`）。

**根因**：Radix FocusScope 在 mount effect 的 cleanup 里 `setTimeout(0)` 派发
`focusScope.autoFocusOnUnmount`，而全局 `afterEach` 的 `cleanup()` 正是触发卸载的地方；vitest 在
**文件结束**时销毁 jsdom（全局 `Event` 还原成 Node 原生实现），挂起回调此刻触发即抛 brand check 错。
全仓 32 个弹层测试文件 + 所有 RAF 调用点同此一雷。

**过程**：第一版是"`afterAll` 等一个宏任务"——只覆盖 0ms 那一类、RAF（jsdom ~16ms）与长延时漏网，
仍是竞态；改为**结构性**做法：`src/testing/timers.ts` 包装 `setTimeout`/`setInterval`/RAF 及对应
clear 登记挂起项，文件结束时 `releaseAll()` **一次性取消**。不变式变成「文件结束前排下的调度，不可能
在文件结束之后跑」。取证的层次：机制单测（假 scope，5 例）→ 端到端探针（弹层文件取消 3 个挂起、
纯逻辑文件 0 个）→ 全量 3 轮 0 unhandled。刻意不接管"文件结束后新排的调度"（那是 harness 自己的
收尾，接了会把 vitest 关停掐死）。规范落地在 `.trellis/spec/unit-test/frontend-testing.md` 新增章节
「环境边界：定时器与 RAF 的文件级收口」，含覆盖边界表与"新增调度机制时先用探针量 >0"的扩展手法。


### Git Commits

| Hash | Message |
|------|---------|
| `c9aa42da` | (see git log) |
| `6ff147a6` | (see git log) |
| `e874e9ae` | (see git log) |
| `280cdaea` | (see git log) |
| `c6dd50ab` | (see git log) |
| `c1714418` | (see git log) |

### Testing

- [OK] 护栏：`pnpm guards run --stage local` → **8/8 通过 / 0 违规**（新增 `check_script_references`：
  52 文件 / 189 处 pnpm 引用 / 72 个已知名字；有效性用"删掉 `scripts.test:host` → 7 处 file:line 违规"
  验证过，恢复即绿）
- [OK] 前端：`pnpm test:fe` **494 文件 / 4422 通过 / 1 skip**；`pnpm test:fe:coverage` exit 0
  （修 pin 漂移前是 exit 1）；覆盖率实测 stmts 60.42 / branch 52.92 / funcs 54.14 / lines 61.55，
  全局地板 54/47/48/55 有富余，`useFileEditorLsp.ts` 的 100% pin 由新用例补回
- [OK] Rust：`pnpm test:rust` **1367 + 103 通过**；`pnpm test:rust:coverage` exit 0（暖态 42.8s；
  lines **61.76%** ≥ 地板 60，regions 64.30% / functions 57.89%）
- [OK] 全量：`pnpm check` exit 0 / **261–277s**（lint + 三套测试 + host 自检）
- [OK] 定时器收口：机制单测 5/5（假 scope，零真实时钟依赖）；端到端探针 `releaseAll()` 计数
  —— 弹层文件 **3** / 纯逻辑文件 **0**（>0 才算纳管）；全量 `test:fe` **×3 轮 0 unhandled errors**
  （修复前实测约 1/6 轮红）
- [OK] 静态与文档：`lint:fe`（eslint + tsc）、`lint:rust` 全绿；改名后实时面零残留旧脚本名
  （由护栏保证，不靠人肉 grep）
- [OK] 文本完整性：新增/改动文件 NUL 0、U+FFFD 0、行尾无空白残留

### Status

[OK] **Completed**（6 笔全部落地：陈旧副本清理、`test` 家族语义补齐、两套覆盖率成为 CI 门禁、
测试环境边界的结构性收口、规范记录）。两条**待人工**的动作见 Next Steps。

### Next Steps

- **GitHub 分支保护手动加 `backend-coverage`**：`.github/BRANCH_PROTECTION.md` 已写进 required checks
  清单，但仓库设置改不了 —— 不加之前这个门只跑不拦
- 首次真实 PR 触发 `backend-coverage`（冷构建插桩依赖，预计 8–15 分钟），顺带验证本次新引入的两个
  第三方 action（`taiki-e/install-action@cargo-llvm-cov`、`dorny/paths-filter@v3`）在 CI 上可用
- 覆盖率刻意不进 `pnpm check`（保持 ~4.5 分钟）；需要全量数据时单独跑 `pnpm test:coverage`（~99s）


## Session 245: 路径身份字母表：identity 与 exec 双渲染（修 CI Windows 红）

**Date**: 2026-10-01
**Task**: 路径身份字母表：identity 与 exec 双渲染（修 CI Windows 红）
**Branch**: `main`

### Summary

RepoRef::key() 的身份不再绑定宿主路径表示：UnitPath 一个值两个渲染（identity 平台无关 / exec 宿主形态逐字不变），φ = canonical 最深已存在祖先 ⊕ 尾分量，新增 platform/path_identity 渲染规则；删旧单串入口 canonicalize_worktree_path；前端零改动

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 246: 路径解析的阻塞 I/O 落阻塞池（红线 3）

**Date**: 2026-10-02
**Task**: 路径解析的阻塞 I/O 落阻塞池（红线 3）
**Branch**: `main`

### Summary

resolve_repo / resolve_base / 6 处命令直连改走 UnitPath::resolve_async（spawn_blocking 唯一异步入口）；验证期补漏 read_dir_tree 身份解析与 worktree 清单整批归一；行为零变化（1386 条 lib 测试逐条不变，仅 +1 新用例）；spec 增 Scenario

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a99e05c6` | (see git log) |
| `15e11744` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 247: 阻塞 fs 收口：仓库打开/校验清扫 + 命令层护栏（红线 3）

**Date**: 2026-10-02
**Task**: 阻塞 fs 收口：仓库打开/校验清扫 + 命令层护栏（红线 3）
**Branch**: `main`

### Summary

同步核心 + 异步入口成对提供（open_repo_async 无默认实现 / is_git_repo Local 分支落池 / assert_git_repo_async）；5 处调用点改走异步入口；新增 check_blocking_fs_in_commands 护栏（含 run_blocking_result 与抹平注释字面量的判据健壮性修复，单测 14 条）与两条生产分支直测；is_git_repo 探测收敛为单一实现；第三轮 neeko-check 复核同轮收口 spec 与台账

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e0f50516` | (see git log) |
| `90fac3bb` | (see git log) |
| `af0847a7` | (see git log) |

### Testing

- [OK] `pnpm check` EXIT=0（lint:fe + lint:rust + 9/9 护栏 + test:fe + test:rust + test:host）
- [OK] `cargo test --lib` 1388 passed（1386 → +2：`transport::tests::test_local_open_repo_async_matches_sync_core`、`local::diff::tests::assert_git_repo_async_matches_sync_core`）
- [OK] 前端 500 files / 4483 passed；护栏 `check_blocking_fs_in_commands` scanned=44 / 0 命中；框架自检 206 条
- [OK] 旧判据对 5 个新形态的漏报/误报用 scratch 脚本逐一复现，确认修复改变了判据结论而非只多写了用例

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 248: 收口 10-01-library-prompt-dialog-host：AC 自动化验收并归档

**Date**: 2026-10-02
**Task**: 收口 10-01-library-prompt-dialog-host：AC 自动化验收并归档
**Branch**: `main`

### Summary

状态栏 Prompts 弹窗宿主任务收口：补 4/1/2 条测试覆盖 AC1-AC3/AC6，prd AC1-AC9 逐条勾选，门禁全绿，任务归档到 archive/2026-10

### Main Changes

## 背景

`10-01-library-prompt-dialog-host`（状态栏 Prompts 表单弹窗不可见）的代码在早前会话已合入并绿，
但 prd 的 AC1-AC9 未逐条勾选、`implement.md` Step 10 的人工 `pnpm tauri dev` 走查未执行，
任务一直停在 `in_progress`。本次收口。

## 关键决策：把「人工走查」换成 jsdom 集成判据

macOS 无官方 Tauri WebDriver（`tauri-driver` 仅 Linux/Windows），native 窗口自动化不可用。
选择「方案 A'」：把 AC 中能被 jsdom 证明的部分做成应用级集成测试，零新依赖、复用既有
`AppModals.test.tsx` 的 Provider 组合。

唯一无法自动化的物理层事实 —— 「OS 是否真把 portal 画在 Browser 子 webview 之上」 ——
由既有同类浮层（`ConfirmHost` / `CloseConfirmDialog`）长期生效作证，不再要求人工走查。

## 改动（测试补强，3 个文件）

1. `src/features/status-bar/__tests__/PromptsStatusSection.test.tsx`
   新增 `it.each(['cancel','close','escape','overlay'])` 四关闭路径（AC2）。此前只测 Cancel；
   × / Esc / 遮罩同样走 `onOpenChange(false) → settleVariableDialog(null)`，不看住就会退化成
   「关而不结算」（Promise 悬挂 ⇒ 插入静默丢失）。Radix 外部关闭是 `pointerdown`（不是 mousedown）——
   首跑 overlay 用例即红（`variableRequest` 仍为 `"hi {{name}}"`），改事件类型后绿。
2. `src/features/browser/hooks/__tests__/useBrowserTab.test.ts`
   新增「浮层打开期间隐藏 webview」（AC6）：钉住派生公式 `isActive && !anyOverlayOpen && !!tabExists`
   （无浮层 visible / 有浮层隐藏 / 关闭恢复）。断言点在 `useBrowserWebview` mock 的
   `mock.lastCall[0].visible` —— 该值不对外返回。
3. `src/app/__tests__/PromptDialogHosting.integration.test.tsx`（新）
   真 `AppCenter`（settings 分支卸载 workspace/library）+ 真 `AppModals`，`appView ∈ {normal, settings}`
   各跑一遍（AC1/AC3）：Library 未挂载时弹窗仍渲染、经 Radix portal 不在中心视图子树内
   （`within(centerView).queryByRole('dialog')` 为空，不直取 node）、确认后 Promise `resolves` 渲染文本、
   `overlayStore.count` 归零。

## 门禁

- `pnpm test:fe` → 501 files / 4490 passed | 1 skipped（+1 file / +7 tests，全为本任务新增）
- `pnpm lint:fe` → 0 error（唯一 warning 为既有 `VirtualList.tsx`）
- `pnpm guards run --stage local` → 9/9 通过（206 条框架自检），`check_path_identity_scope` debt 0
- `pnpm check` → 全绿（eslint 0 / tsc 0 / cargo fmt+clippy 0 / rust lib 1388 passed / host OK）
- `pnpm build` → 成功（vite build 20.1s）

修掉的 lint 拦路：新文件需 PASCAL_CASE → 改名 `PromptDialogHosting.integration.test.tsx`；
`closest`/`document.body` 触发 `testing-library/no-node-access` → 改用 `within(...)` + `getByRole`；
`useBrowserTab.test.ts` 导入顺序按 `import/order` 重排。

## 台账

- `prd.md` AC1-AC9 逐条勾选 + 证据（测试名 / 命令输出）；状态行从「规划中（未动代码）」改为「已实现」。
- `implement.md` 新增 Step 12 记录本次收口；Step 10 的人工走查条目标为已由自动化替代。
- `implement.jsonl` / `check.jsonl` 补入 4 + 3 条 spec 引用（component-guidelines / status-bar /
  state-management / frontend-testing）。
- `task.py archive library-prompt-dialog-host` → `archive/2026-10/`，auto-commit `fc4fb9dc`。

## 遗留

测试改动（3 个文件）**未提交**，留待用户按仓库约定提交（本会话遵循「不主动提交代码」）。


### Git Commits

| Hash | Message |
|------|---------|
| `fc4fb9dc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 249: Git 长操作取消通道 + Console 可见性

**Date**: 2026-10-05
**Task**: Git 长操作取消通道 + Console 可见性
**Branch**: `main`

### Summary

push/fetch/pull/commit 去墙钟 + 可取消（GitSyncSlots 按 RepoRef::key() 分槽、kill_tree 树杀、kill 确认有界 5s）+ stdout/stderr 16KB/50ms 合流进仓库级 Console；全入口统一 runGitConsoleOp（含 ProjectsPanel/CommitDialog）；新增 check_long_git_op_wall_clock 护栏。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d4e3b05d` | (see git log) |
| `24b13ff3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 250: 归档 worktree 身份链 + 承接 AC13 遗留任务

**Date**: 2026-10-05
**Task**: 归档 worktree 身份链 + 承接 AC13 遗留任务
**Branch**: `main`

### Summary

归档 10-02-blocking-fs-sweep / 10-01-async-path-resolution / 10-01-path-identity-alphabet / 09-26-worktree-repo-identity（接受 AC13 为已知缺口）；新建 10-05-wsl-ssh-remote-changes-parity 承接 WSL/SSH 远端 Changes 现场核对。归档前逐条核验：unit_path::resolve 为唯一产出点、canonicalize_worktree_path 无调用点、resolve_base 已 async、git/commands 无 UnitPath::resolve(、§12 已同步。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7921e52e` | (see git log) |
| `6a3e4f7d` | (see git log) |
| `307a1a52` | (see git log) |
| `05cf52fd` | (see git log) |
| `a469ec30` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 251: 应用退出时收敛 git 子进程树（共享单一 kill 动作）

**Date**: 2026-10-06
**Task**: 应用退出时收敛 git 子进程树（共享单一 kill 动作）
**Branch**: `main`

### Summary

commit cancel 与 exit 到同一个可重调 KillFn（Arc<dyn Fn()->KillFuture>）：新增 common/executor/child_registry 在子进程存活期登记该动作，shutdown_background_and_exit 的 CleanupTask 驱动 kill_all_live；Local/WSL 本地树杀、SSH 远端新通道 kill -9。修了一个 Block：Local/WSL 的 wait 跨 await 持 Mutex<Child> 导致退出 kill 抢不到锁而死锁，改为短锁 try_wait 轮询并加回归测试。WSL/SSH 本地未验证，交 CI windows job 与 10-05-wsl-ssh-remote-changes-parity。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `626dd7a3` | (see git log) |
| `d2397ca1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 252: 不变量强制层级：元机制 + 三条延期项落层

**Date**: 2026-10-06
**Task**: 不变量强制层级：元机制 + 三条延期项落层
**Branch**: `main`

### Summary

把『约定无机制』类债务根治：新增 invariants.json 台账 + check_invariant_enforcement 门禁（含 guard→红线引用完整性），并把三条延期项落层 —— activate 收 WatcherEventSink 端口（依赖倒置）+ services 禁 tauri 护栏、status 收敛到 selectors + 判据 7、组件 ≤300 ratchet（基线 59）。新增 4 条护栏 / 三份台账 / 共享 AppStateWrapper 夹具（消 3 份重复）；pnpm lint（14 护栏/263 自测）、test:fe 503 文件 4514 通过、test:rust、test:host 全绿；未提交。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 253: WSL/SSH 代码层闭合：远端 status 编排可测 + 远端侧栏 chip 与本地同源

**Date**: 2026-10-06
**Task**: WSL/SSH 代码层闭合：远端 status 编排可测 + 远端侧栏 chip 与本地同源
**Branch**: `main`

### Summary

① 把 activate 抽出 activate_with(transport, has_push_producer) 内部缝，用本地 transport + has_push_producer=false 驱动原「远端 pull 分支」，新增 2 条 cargo test（收口+现算+不挂载+不产事件；未挂载读必现算并登记），AC13 真机项降级为确认；② 远端侧栏 ConnectionWorktreeList 的 chip 改为订阅 projectStore.statuses + 挂载级新鲜度守卫（失败=未知不出 chip 且可重试，不再写 0/0、不再一生只拉一次），并抽共享 hook useWorktreeChangeStats 供本地/远端侧栏复用（消重 + 组件 300→252）。护栏 14/263 自测、test:rust 1419+103、test:fe 504 文件/4517、test:host 全绿；未提交。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 254: 修复 neeko-check 违规清单：StrictMode 丢结果 + 订阅粒度 + 护栏误伤 + 夹具重复

**Date**: 2026-10-07
**Task**: 修复 neeko-check 违规清单：StrictMode 丢结果 + 订阅粒度 + 护栏误伤 + 夹具重复
**Branch**: `main`

### Summary

Block：useWorktreeChangeStats 误把组件生命周期取消（cancelled）用到全局 store 写入上，StrictMode 重挂下『首轮丢弃 + 次轮跳过』⇒ chip 永不出现；删除 cancelled 并补 StrictMode 回归（临时回插 cancelled 实测变红→绿）。Warning：改用 useShallow 按单元浅订阅 selectEntries（别的单元/项目快照不再重渲本列表），并删除随之无用的 selectStatuses（更紧的封装）；check_service_no_delivery_dep 匹配前剥字符串与行内注释（消误伤，+2 测试）。Nit：init_git_repo 抽到 common/testing（status.rs 与 lifecycle_tests 共用，消第 2 份重复）；『不重拉』断言去 setTimeout 改确定性；台账指针补 note。门禁：pnpm lint（14 护栏/265 自测）、test:rust 1419+103、test:fe 504 文件/4518、test:host 全绿；未提交。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 255: 收口 neeko-check Nit 清单：单飞去重 + 已拉清单收敛 + 护栏容错

**Date**: 2026-10-07
**Task**: 收口 neeko-check Nit 清单：单飞去重 + 已拉清单收敛 + 护栏容错
**Branch**: `main`

### Summary

逐条优化：① useWorktreeChangeStats 的 ChangeStat 收为非导出；② 已拉清单随列表收敛（移出后再加回会重拉、不再无界增长）；③ 新增进程级单飞 inFlight，本地+远端侧栏同挂同一单元不再 2× RPC（+1 测试）；④ check_component_size._line_count 容错（非 UTF-8/IO 跳过而非打成护栏 ERROR）；⑤ check_invariant_enforcement 真实台账用例改断言 !=ERROR（台账写错报 VIOLATION 而非伪装成护栏坏了）；⑥ check_service_no_delivery_dep docstring 声明行级字符串剥离的边界。门禁：pnpm lint（14 护栏/265 自测）、test:rust 1419+103、test:fe 504 文件/4520、test:host 全绿；未提交。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 256: 核查 Problems 面板三项延期声明：按性质分层落位（spec 决策记录 + 台账不变量）

**Date**: 2026-10-07
**Task**: 核查 Problems 面板三项延期声明：按性质分层落位（spec 决策记录 + 台账不变量）
**Branch**: `main`

### Summary

把三条延期声明按性质分层：行 key 碰撞是**不变量**（机制已在、登记缺失）→ 落台账 tier=test（problems-row-key-uniqueness / problems-group-render-incrementality）；投影重算与阈值硬编码是**成本决策**→ 只留 spec prose（带实测 0.10ms/200 组与升级触发条件 G>1000 或 >1ms），不进台账（避免被 prose 档标成债务）。改 spec §5 四条 + 修重复编号 ## 4.→## 7. + 标题 P1-P3→P1-P4，台账 +2 条；零代码改动。门禁：pnpm lint 全绿（tsc + eslint + cargo fmt/clippy -D warnings + 14 护栏 + 护栏自测 265 OK），check_invariant_enforcement 12 条不变量 / 0 违规，guards list 仍 14 条；已拆为 `4175c8b2` + `a4a0bcc6` 两次原子提交。

### Main Changes

**核查结论（三条延期声明的真实性质）**

| Note | 性质 | 现状 |
| --- | --- | --- |
| 行 key `${message}-${line}-${char}-${severity}` 重复诊断碰撞 | **不变量**（违反=React 错配/丢行，用户可见，已违反过一次） | 机制已在（`fe893baf` 加 `#occurrence`），但未登记 |
| `buildGroups` 每次 store 变化全量重排 | **成本决策** | 函数已改名 `orderDiagnosticFileGroups`；实测 0.10ms/200 组，与行数无关 |
| `COLLAPSED_GROUP_THRESHOLD=20` 硬编码无设置项 | **成本决策** | 保持不变（可配置性成本 > 收益） |

**A `.trellis/spec/backend/lsp-domain.md`（+22/-5，§5）**：删掉两行「已知边界（不扩）」，替换为
① 分组增量契约（落点 `DiagnosticsPanel.perf.test.tsx`）；② 列表投影每 flush 重算 —— 决策非债务，
带实测 0.10ms/200 组（本机口径非 SLA）、与行数无关、升级触发条件 G>1000 或 flush>1ms，并显式
区分「虚拟滚动解的是 DOM 行数，另一维，不可互相替代」；③ 行 key 唯一性（指纹 `M-L-C-S` 自右分解
唯一 + 同指纹序号）；④ 折叠阈值 20 —— 决策非债务，若可变化走 prop+默认值而非全局设置。标题
`P1-P3`→`P1-P4`（与代码注释的 P4 对齐）；触发叙事里的 `buildGroups` 标为历史名并给出当前落点；
顺带修掉重复编号 `## 4. 常见坑`→`## 7.`（该文件原有两个 `## 4.`）。

**B `tools/guards/ledger/invariants.json`（+28）**：追加 `problems-row-key-uniqueness`（落点
`diagnosticGroups.test.ts` + `DiagnosticsPanel.test.tsx`）与 `problems-group-render-incrementality`
（落点 `DiagnosticsPanel.perf.test.tsx`），`red_line: null`。判据：只登记**不变量**（必须成立、可
机械判定、有历史违反）；Note 1/3 是**决策**，留在 spec prose 不进台账——否则 `prose` 档会把一个正确
的取舍标成「每次门禁可见的债务」。复用既有机制（台账只存指针 → 已有机理），未新增护栏、未改一行
checks 代码。

**未做（触发条件已写入 spec）**：虚拟滚动、`uri→label` 缓存、阈值设置项。


### Git Commits

- `4175c8b2` docs(spec): turn the Problems panel's lingering notes into decision records
- `a4a0bcc6` chore(guards): register the two Problems-rendering invariants
- 本文件（workspace 记录）随本次提交落地

### Testing

- [OK] `pnpm lint` 全绿：`tsc --noEmit` + eslint + `cargo fmt --check` + `cargo clippy -D warnings`；14 条护栏 14 通过 / 0 违规，护栏自测 265 tests OK
- [OK] `check_invariant_enforcement`：12 条不变量 / 15 个 guard 文件 / 0 处违规（新增 2 条落点解析通过，`red_line: null` 合法）
- [OK] `pnpm guards list` 仍 14 条（未新增护栏、无 stage/scope 变更）
- [OK] 台账落点测试实跑 15 passed（`diagnosticGroups.test.ts` + `DiagnosticsPanel.perf.test.tsx`）；前端零改动故未跑 `test:fe`
- [OK] `rg buildGroups .trellis/ docs/ src/` 仅剩 2 处**历史引用**（spec §5 已标注「当时」；另一处为归档任务 prd，不改写）

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 257: Git changes realtime: refs watcher + ahead/behind on the single snapshot

**Date**: 2026-10-08
**Task**: Git changes realtime: refs watcher + ahead/behind on the single snapshot
**Branch**: `main`

### Summary

Made the Changes panel reflect external git operations (push/fetch/commit) without manual refresh. Closed the freshness gap by watching refs/** and packed-refs (incl. linked-worktree common gitdir) and by folding ahead/behind into the authoritative GitStatusSnapshot under one producer/version. The change gate now compares the whole snapshot (PartialEq) so new derived fields enter it by type; ahead/behind parsing, entry cap, and the upstream check each have one implementation (shared parser, GitStatusSnapshot::enforce_entry_cap, transport.is_git_repo). Frontend consumes ahead/behind from the version-gated snapshot only; rejected stale snapshots write no derived value. pnpm check green (15/15 guards, FE 4521, Rust 1438+104).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `286aefbf` | (see git log) |
| `d7f79965` | (see git log) |
| `494f3cc0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 258: Gate orchestration: declare lint/test/check gates once

**Date**: 2026-10-08
**Task**: Gate orchestration: declare lint/test/check gates once
**Branch**: `main`

### Summary

Promoted the in-process guard framework to supervise external-command gates. lint/test/check/test:coverage are now one framework call each (zero &&), gates are declared once in tools/guards/ledger/gates.json, and check_gate_topology pins A1/A3 so CI/lefthook wiring cannot drift. Found and fixed a false-green defect (non-zero exit with empty output fell back to PASS). pnpm check green: 379 framework tests, 21 gates, 54s/289s/0.9s test suites.

### Main Changes

- 复用判据层而非新建框架：`Gate(Guard)` 把外部命令门禁接进既有 registry / runner /
  report / selftest；`tools/guards/core/` 里零工具链名（AC4）。
- 单一声明源 `tools/guards/ledger/gates.json`（10 条 gate）+ `--suite`（kind）/`--source`
  （形态）两个正交过滤；`package.json` / `lefthook.yml` / `ci.yml` 收敛为单次框架调用，
  孤儿 `check:fe` / `check:rust` 链删除。
- 三态与可见性不退化：平台不匹配记显式 SKIPPED（计数可见，不再把「没检查」伪装成通过）、
  `--jobs` 并发、fail-fast 不中断已在跑的门禁、门禁输出末行进 metrics、输出有界。
- 新护栏 `check_gate_topology`：A1（声明了 `ci` 的 gate 必须在指定 job 内）与 A3
  （hook 只允许单次框架调用，不得再手写门禁或出现 `&&`）。
- **缺陷修复**：非零退出 + 零输出曾落回 PASS（verdict 由 findings 推导）——`_run_gate`
  合成携带退出码的 Finding，`GuardResult.violated()` 拒绝空 findings；两个回归测试。
- 文档/台账：`invariants.json` 登记 `gate-topology-single-source`；CONTRIBUTING /
  CONTRIBUTING_CN / AGENTS / `.trellis/spec/guides/invariant-enforcement.md` 同步。

### Git Commits

| Hash | Message |
|------|---------|
| `c6c6e352` | (see git log) |
| `8f75c6f9` | (see git log) |
| `50423c75` | (see git log) |

### Testing

- [OK] 框架自检 379 用例 OK；`pnpm check` 21/21 全绿（test_fe 48.6s / test_rust 309s / test_host 0.9s）
- [OK] `run --stage commit --staged` 18/18；`run --stage ci --suite lint --source python` 16/16；`lefthook validate` All good
- [OK] AC3 与改造前基线逐字对比：15 条既有护栏的 stage 集合无变化、无丢失
- [OK] A1/A3 由 `check_gate_topology` 在真实仓库与 16 个夹具用例上验证；A2/A4/`require_tools` 登记为批次 2 可见债务

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 259: Real-source test determinism contract

**Date**: 2026-10-08
**Task**: Real-source test determinism contract
**Branch**: `main`

### Summary

Fix the Windows-only flake where git-meta watcher tests asserted an absolute zero on an event observer. Replace the cross-callback zero asserts with a positive-only CallbackProbe, codify the determinism contract (real sources promise reachability, not an exact event set; classification negatives live in the pure layer, lifecycle negatives must be differential), add the check_nondeterministic_event_assertions domain guard plus its ledger invariant, and wire the spec index/backend-testing pointers. Windows leg of AC1 still needs CI backend-test (windows-latest).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `adcf1399` | (see git log) |
| `c95c5347` | (see git log) |
| `4c4150cd` | (see git log) |
| `b723c7c4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 260: Worktree 场景下的程序运行与调试：执行单元根唯一化

**Date**: 2026-10-08
**Task**: Worktree 场景下的程序运行与调试：执行单元根唯一化
**Branch**: `main`

### Summary

DAP 域新增唯一单元解析点 ExecUnit/resolve_unit（复用 RepoRef）；构建 cwd 校验基准、会话 workspace、${workspaceFolder}、launch.json 读写根全部改为单元根；5+3 个 DAP 命令新增 worktree_path（前端经 unitRootForProject 派生）；停点源码读取补 InProject scope（worktree 源码恢复可编辑）。pnpm check 22/22 绿。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 261: 领域命名收敛：App → Project → Workspace（全栈对齐 + 四轮复核修复）

**Date**: 2026-10-09
**Task**: 领域命名收敛：App → Project → Workspace（全栈对齐 + 四轮复核修复）
**Branch**: `main`

### Summary

分层术语统一为 App→Project→Workspace（能力容器）/ checkout（git 属性）/ worktree（仅 git 原生）。全栈落地：Rust 类型(RepoRef→WorkspaceRef/WorktreeRef→Checkout/UnitPath→CheckoutPath/ExecUnit→ExecWorkspace)、wire(repo_key→workspace_key)、命令(get_repo_status→get_workspace_status/set_active_repo_unit→set_active_workspace)、前端(RepoKey→WorkspaceKey/worktreeStore→workspaceStore/useWorktreeState→useWorkspaceState)、护栏(check_repo_unit_identity→check_workspace_identity)。四轮复核修复残留 unit/repo/worktree 命名并沉淀边界规则到 docs/domain-model.md。pnpm check 22/22 全绿。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f784b8e7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 262: Watcher boundary & cost model: ignored subtrees zero-watch

**Date**: 2026-10-10
**Task**: Watcher boundary & cost model: ignored subtrees zero-watch
**Branch**: `main`

### Summary

Watch boundary is now an explicit manifest: ignored subtrees produce no watch input (macOS physical FSEvents exclusion + cross-platform structure-event convergence); added user-level watcherExclude and a bounded read layer. Four independent trellis-check rounds closed all findings; pnpm check green.

### Main Changes

### Watcher boundary & cost model

Made the file-watch boundary an explicit value object instead of relying on
callback filtering, so `.gitignore`d subtrees produce no watch input at all.

**Delivered (W0–W4)**
- `WatchManifest` (visible dirs + top-level ignored roots) + `WatchBackend`
  capability enum replacing the misleading `WatchStrategy::{Selective,Recursive}`.
- `structure_event_paths` now converges against the ignore filter: paths inside
  ignored subtrees are dropped; only the ignored root's own create/remove/rename
  boundary event is kept (gray-node updates via the parent watch).
- macOS: self-written FSEvents `notify::Watcher` that physically excludes
  ignored roots via `FSEventStreamSetExclusionPaths`, with runtime fallback
  (`NEEKO_DISABLE_FSEVENT_EXCLUSION`) and exclusion-stream rebuild on ignore
  rule changes / runtime-appearing ignored roots.
- User-level `watcherExclude` (VS Code `files.watcherExclude`-style), merged
  into the single `GitIgnoreFilter` decision point (registration, event
  classification, tree read). Injected via `StorageManager` provider so the
  watcher domain no longer reads global config paths.
- Read layer bounded by `MAX_DIR_ENTRIES` + `truncated` (2MB IPC limit).

**Decisions / accepted exceptions**
- AC4 of the PRD closed as an explicit exception: `SelectiveRegistration` cap
  overflow still degrades to recursive (preserves git-domain.md §14 lower
  bound); documented in `design.md` §4 + `degrade_recursive` comment.
- W2 `!reinclude` under a physically excluded subtree does not deliver events
  (registered as a second known exception in `git-domain.md` §14).
- Non-git projects: `watcherExclude` is inert (registered in W4 residuals).

**Verification**
- Four independent `trellis-check` rounds: no Block; all Warning/Nit closed.
- `pnpm check` green (23/23 gates, `test_rust` ~300s incl. real FSEvents suite).


### Git Commits

| Hash | Message |
|------|---------|
| `c690c8df` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
