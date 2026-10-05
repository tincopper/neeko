# Design — Worktree 场景 Git status 身份单点化

> 配套 `prd.md`（需求与 AC）。本文件回答「模型应该长什么样、为什么、以及兼容性」；执行顺序在 `implement.md`。
> 证据行号基线：`main` @ `1739cc70`（2026-09-26 逐条核实）。

## 1. 现状：一条以 `project_id` 为唯一身份的状态链

```
                    ┌──────────────── 后端（每 project 一套） ────────────────┐
 notify(项目根, 递归) ─┐                                                        │
 git_meta(.git +      ├─► ThrottleScheduler ─► GitStatusWorker ─► git -C <项目根> status --porcelain
   worktrees/** +     │  └► (worktree 事件只发 git-changed，不驱动 worker)        │
   linked wt 根) ─────┘                                                        ▼
                                                    snapshots: HashMap<project_id, Arc<GitStatusSnapshot>>
                                                                             │ emit
                    ┌────────────────────────────────────────────────────────┘
                    ▼
        git-status-snapshot{project_id, version, entries}   /   git-changed{project_id}
                    │
                    ▼
 ┌── 前端：单槽 per project ────────────────────────────────────────────────┐
 │ projectStore.projects[i].git_info.changed_files   ← 5 个写者            │
 │ projectStore.statusVersionByProject[project_id]   ← 只按 project 计版本 │
 │ worktreeStore.activeWorktreePath（全局镜像）+ worktreeStateMap + session │
 └─────────────────────────────────────────────────────────────────────────┘
                    ▼
   ChangesList / 侧栏 +A-D / 文件树着色 / ahead-behind 徽章 / diff tab
```

关键事实：**worktree 在这条链上没有任何位置** —— 它既不是 worker 的输入 path，也不是快照表的键，也不是事件载荷的一部分，只是前端在 pull 时刻临时塞进命令参数的一个字符串。

## 2. 证据清单

### 2.1 后端

| # | 事实 | 位置 |
| --- | --- | --- |
| D1 | 每 project 一套 worker，`repo_path` 固定为项目根；快照表 `HashMap<project_id, Arc<GitStatusSnapshot>>` | `common/file/watcher/manager/core.rs:39,128,153-184` |
| D2 | worktree 读接口不查快照，走 transport 现算并返回 `version: 0` | `git/commands/query.rs:69-91` |
| D3 | 事件载荷无单元身份：`GitChanged(&str)` 只有 project_id；快照载荷只有 `project_id + version` | `common/file/watcher/sink.rs:34-37`、`status_worker/writer.rs:13-24` |
| D4 | worktree 的 changed_files 由**第二套引擎**（libgit2）计算，与主链路（CLI porcelain + `parse_status_line`）并存；`renamed_from` 在该分支恒 `None` | `common/git/operations/files.rs:23-37`、`common/git/local/status.rs:40-51,94-108` |
| D5 | 写后 poke 的主键是 project → 打中的是主仓 worker；worktree 内 stage/discard 不会让任何 worker 产出新快照 | `git/commands/index.rs:15-22`、`status_worker/worker.rs:196-209` |
| D6 | `commit_files` 与 `create/remove/rename_worktree` 完全不 poke（现状只靠 git-meta watcher 的 `git-changed` 偶然触发） | `git/commands/commit.rs`、`git/commands/worktree.rs`（`wait_status_fresh` 全仓仅 `index.rs` 5 处） |
| D7 | worktree 路径**校验时 canonicalize、返回时丢弃结果** → 同一工作树可有多种字符串进入系统 | `common/git/path_guard.rs:66-92` |
| D8 | 工作树清单本身有两个生产者（libgit2 `find_worktree` vs `git worktree list --porcelain`），后者靠 `remove(0)` 的顺序假设剔除主仓 | `common/git/local/worktree.rs:16`、`common/git/operations/info.rs:102-110`、`operations/worktree.rs:105` |
| D9 | `.git/worktrees/**` 与 linked worktree 工作目录的事件被归类为 `WorktreeMetaChanged`，**只发 `git-changed(project_id)`**，不驱动任何 status 重算 | `common/file/watcher/git_meta/watcher.rs`、`classify.rs:39-48`、`manager/core.rs:333-350` |

### 2.2 前端

| # | 事实 | 位置 |
| --- | --- | --- |
| F1 | `changed_files` 与 version gate 都是 per-project 单槽 | `shared/store/projectStore.ts:18-30,49-65,86-111` |
| F2 | 声明「唯一写入口是 `applyGitStatus`」，实际另有 3 条裸 `setState` 通道（`useRefreshGitInfo`、`useSessionBootstrap`、`load_projects` 合并） | `features/git/hooks/useRefreshGitInfo.ts:44-60`、`features/session/hooks/useSessionBootstrap.ts:53-67,137-160`、`features/project/hooks/useLocalProjects.ts:84-99` |
| F3 | 聚焦刷新硬编码 `''` 作为 worktree 路径，且 `schedule` 会覆盖同 key 待执行的 worktreePath；`allowEqual` 让同版本主快照也能覆盖 → **S1 的确定性质路径** | `features/git/hooks/useGitStatusEventsSync.ts:168-175`、`features/git/utils/gitStatus.ts:28-41,78` |
| F4 | 补丁式守卫：worktree 激活时整体丢弃主仓快照（判据是**全局镜像**，不是事件身份） | `features/git/hooks/useGitStatusEventsSync.ts:119-122` |
| F5 | 「激活 worktree」有三份表示：全局镜像 + `worktreeStateMap` + session `worktree_state`；镜像只在部分写路径同步，`clearWorktreeForProject` 只改 map 且全仓无调用者 | `shared/store/worktreeStore.ts:9-15`、`features/project/hooks/useWorktreeState.ts:32-129`、`features/session/hooks/useSessionPersistence.ts:17-45` |
| F6 | 任意 projectId 的刷新都用全局镜像作为 worktree 路径 → 跨项目串数据；后端不做 containment 校验故不会拒 | `features/project/hooks/useLocalProjects.ts:283-301`、`path_guard.rs:61-76` |
| F7 | 派生集合的键不含单元：`ChangesList key={project.id}`（勾选/展开缓存不随 worktree 切换重置）、`aheadBehindKey('local', pid, pid)`、侧栏 +A/-D 只首拉一次 | `features/git/components/GitCommitPanel.tsx:200-203`、`useGitStatusEventsSync.ts:106`、`features/project/components/WorktreeList.tsx:66-86` |
| F8 | worktree 存活用裸字符串等值判定 → 形态不一致即静默退回主视图（S3） | `app/hooks/useAppShellData.ts:127-142` |
| F9 | 启动顺序：先按 `''` 拉主仓，之后才恢复激活 worktree，中间无 worktree 拉取（S3 首屏） | `features/session/hooks/useSessionBootstrap.ts:153,169-199` |

## 3. 目标模型

### 3.1 身份：`RepoRef`（唯一新抽象）

```
RepoRef { project_id: ProjectId, worktree: WorktreeRef }
WorktreeRef = Main | Linked { canonical_path: PathBuf }     // 后端
前端镜像：  repoKey = projectId + '\0' + (canonical_path ?? '')   // 唯一 keyOf()
```

- **一个定义点**：后端 `common/git/repo_ref.rs`（新），前端 `src/shared/utils/repoRef.ts`（新）。全仓禁止第三处拼接（`tabKey.ts` 保持既有语义，但它本身就是这个模式的先例）。
- **canonical 唯一来源**：后端在产出工作树清单时即 `canonicalize()`（D7/D8 合并为单一清单实现：`git worktree list --porcelain` + `parse_worktree_list`，主仓条目按 `git rev-parse --git-common-dir` 判定而非「第 0 条」的位置假设）。前端不再自行归一（红线 12）。
- **为什么不叫 `WorktreeId`**：主仓也要占槽。身份的对象是「仓库工作树」，主仓是它的退化情形——命名上就消除「worktree 是特例」这个错误前提（正是这个前提导致 D1/D2 把 worktree 排除在 worker 之外）。

### 3.2 生产者：`WatcherManager` 的资源键从 project 升为 `RepoRef`

**已定（D-B）= 方案 B「只挂激活单元」**。三方案的原始对比保留在下面，作为「为什么不选 C」的记录：

| 方案 | 描述 | 结果 |
| --- | --- | --- |
| A. 全量常驻 | 项目激活即为该仓库全部工作树挂 worker + watcher | 否决：N × (线程 + 递归监听) 无上限 |
| **B. 只挂激活单元** | 单元成为当前视图时 `ensure_watched`（幂等），离开即 `unwatch` 真释放 | **采用**：每项目常驻至多一套；代价 = 冷启动窗口 + 非激活单元不实时，用 I1-b（未挂载即「未知」）把代价转成可判定的空态 |
| C. 激活挂 + 已挂保留 | 挂上后保留至 project unwatch | 否决（用户决策）：常驻量随会话内打开过的工作树数单调增长 |

B 的两条硬性配套要求（否则 B 会退化成新的陈旧数据源）：

1. **激活时序唯一化**：前端只有「当前视图单元」这一个派生函数能驱动 `set_active_repo_unit`；该命令内部完成「释放上一单元 → 挂载新单元 → 有界等待首个快照」，读接口因此永远命中热快照，不存在「刚激活读到空」的二态。
2. **失效即清空**：单元被 `unwatch` 时其后端快照条目与前端槽位一并失效（不是保留后复用）。切回时靠 1 重建。

- 复用优先：`GitStatusWorker::start` / `ThrottleScheduler` / `create_git_meta_watcher` / `GitIgnoreFilter` **内部实现不改**，只是调用参数从「项目根」换成「该单元的 workdir + 该单元的 gitdir」（`resolve_git_meta_paths` 已能解析 linked worktree 的 gitdir 指针文件，直接复用）。
- 文件 watcher 的根同样换成该单元 workdir → 顺带修正 worktree 场景下文件树 / ignored 标注 / `file-changed` 一直只跟主仓根的事实（`manager/core.rs:324-332` 注释自证了这一缺口）。
- **单元自己的 git-meta watcher 只看自己的 HEAD/index**：主仓的 `.git/worktrees/**` 与「别的 worktree 的工作目录」不再被本单元监听 → `resolve_worktree_roots`、`has_worktrees`、`rearm_worktrees_if_needed`、`on_worktree_meta_changed` 整套跨目录补挂机制**整体退役**（它存在的唯一理由就是「worktree 没有自己的资源」）。
- 必须同步改的点：`snapshots: HashMap<RepoRef, _>`、`poke_status_worker_and_wait(&RepoRef, ..)`、`gitignore_for(&RepoRef)`、`WatcherHandle` 生命周期、`watch` 入口幂等护栏按 `RepoRef` 判定（`core.rs:129-141`）。
- **主仓 worker 不再跑 worktree 的 status，worktree worker 也不再跑主仓的**：`git status` 的 `-C` 参数即身份，闸门（`worker.rs:196-209`）逻辑一字不改。

### 3.3 协议

```
git-status-snapshot  { repo_key, project_id, worktree_path: Option<String>, version, entries, truncated, branch }
git-changed          { repo_key, project_id }          // 语义降级为「提示该单元可能变了」
```

- `version` 单调性改为 **per repo_key**（现在是 per worker，天然满足）。
- `get_worktree_changed_files` / `get_git_info` 的读语义统一为「读该 `RepoRef` 的快照」，`version: 0` 分支随 D2/D4 一并删除（R3.2）。
- 事件名仍走常量单源（红线 5）：载荷换形状、事件名不变，双端只改结构体/接口。
- **兼容策略 = 不兼容（D-C）**：载荷直接换成上面的新结构，**不加 `#[serde(default)]`**，不保留 `project_id`-only 的旧读取分支，也不做「缺 `repo_key` 视为 Main」的兜底。双端必须同一批落地 —— 这正是「一次做穿」（D-A）的含义：任何兜底分支都会在下一个调用点被误用为新的一条身份路径。
- `repo_key` 由**后端唯一产出**（`RepoRef::key()` 字符串），前端只做透传与 map 键；前端构造 key 只允许经 `repoKeyOf(projectId, canonicalWorktreePath)`，且其入参路径一律来自后端清单（已 canonical）。双端各有一条 golden 测试钉住同一输入产出同一字符串。

### 3.4 单一计算引擎

- 只保留 CLI porcelain：`GitStatusWorker` 产 entries → `parse_status_line` 是唯一解析入口（已是现状）；worktree 走同一 worker，只是 root 不同。
- 删除 `operations::get_worktree_changed_files` 的 libgit2 分支（D4）与 `local/status.rs::get_changed_files_from_repo` 的生产调用；`local/status.rs` 的测试若仍有价值，改为对 `parse_status_line` 的等价断言（避免为旧引擎留活体测试）。
- 收益：AC8 的双词表差异（`renamed_from`、`is_dir`、XY）从结构上消失；`useUntrackedDirExpansion` 的折叠目录语义在两种视图下终于一致。
- 代价：worktree 的 status 从 libgit2 进程内调用变成 fork+exec。主仓已证明该成本可接受（毫秒级、有 1000 条封顶 + `collapsed_probe` 有界探测 + `GIT_OPTIONAL_LOCKS=0`），且 worktree 现在**每次刷新本来也要 fork 若干 git 命令**（`local/status.rs:118-150` 两条 `diff --numstat`）→ 实测净变化预期为中性偏优（AC11 给数据）。

### 3.5 前端状态形状

```
projectStore:
  projects[i].git_info: { current_branch, branches, git_provider }   // 真正 per-project 的字段
  statuses: Record<repoKey, { entries: FileChange[], version: number,
                              branch: string, truncated: boolean,
                              ahead_behind: AheadBehind | null }>     // per-单元，唯一写入口 applyStatus
selectors:
  selectActiveRepoKey(state): repoKey                                 // 唯一「当前视图是哪个单元」的派生函数
  selectStatus(state) = statuses[selectActiveRepoKey(state)]
```

- `changed_files` 不再是 `git_info` 的字段，`is_clean` 由 `entries.length === 0` 派生（禁止冗余状态）。
- 写入口只有一个：`applyStatus(repoKey, snapshot)`，内部做 version gate（gate 表就是 `statuses[repoKey].version`，不再另立 `statusVersionByProject`）。F2 的三条旁路改道；`load_projects` 的「非空就保留」直接删除（它存在的唯一理由——读接口比快照旧——已由 R3.2 的版本统一消除）。
- F4 的守卫删除：主仓快照落主仓槽天经地义，「是否丢弃事件」不再取决于激活态。
- F3 的 `''` 改法：`selectActiveRepoKey` 是唯一来源；刷新入口的签名收敛为 `refreshStatus(repoKey)`，不接受裸 worktreePath 字符串（编译期堵住「传错身份」这一整类缺陷）。

### 3.6 派生集合的键（R4.3）

| 派生态 | 现在的键 | 目标键 |
| --- | --- | --- |
| 勾选集（`useFileSelection`） | 组件实例（随 project 重挂载） | 随 `repoKey` 重挂载（`key={repoKey}`）或 store 按 repoKey 存 |
| 折叠目录展开缓存 `dirFilesMap` | 相对路径 | `repoKey` 作用域（同项目两工作树相对路径同形不同义） |
| ahead/behind | `local:{pid}` | `local:{pid}:{worktreeKey?}`（复用 `aheadBehindKey` 的复合键思路） |
| diff tab / 终端 tab | `projectId:wt:{path}` ✅ | 已是正解，作为 R1.1 的**复用样板**，不改 |
| 侧栏单元徽标 +A/-D | 首拉即永久 | 订阅该 repoKey 的 status（自动失效） |

## 4. 兼容与迁移

- **session 文件 `worktree_state: Record<projectId, path>`**：形状继续用（它就是「每项目一个激活单元」），但与 `worktreeStateMap` 合一为单一来源；加载时以后端 canonical 形态校验（非法/已消失 → 显式回落主视图 + 一次 warn，而不是 F8 的静默清除）。
- **不做双端灰度兼容（D-C）**：`GitStatusSnapshot` / `git-changed` 载荷、`ChangedFilesPayload`、`GitInfo` 的字段变更必须在**同一批**内双端落地；不留 `serde(default)`、不留旧字段、不留「读不到新字段就走老逻辑」的分支。
- **删除清单（R5.2b）**：`useGitStatusEventsSync.ts:119-122` 守卫、`gitStatus.ts:78` `allowEqual`、`projectStore.ts:100-107` 的 `version<=0 恒放行`、`useLocalProjects.ts:84-99` 的「非空就保留」、`worktreeStore` 三个镜像字段、`query.rs:69-81` 双形态读、`operations/files.rs:23-37` + `local/status.rs::get_changed_files_from_repo` 生产调用、`git_meta/{paths,watcher,classify}.rs` 的跨 worktree 补挂机制。
- **`~/.neeko/config.json` / `sessions.json` 结构**：不新增字段类型，只减少一份冗余表示。
- **回滚点**：见 `implement.md` 的 Step 边界与每步末尾的回滚说明。

## 5. 权衡与被否决的方案

| 备选 | 否决理由 |
| --- | --- |
| 只删 `worktreeStore` 全局镜像、其余不动（把 (1) 当终态） | 治不了 S2：worktree 依然无生产者，新鲜度仍靠「事件恰好触发 + 拉取恰好带对路径」。只能算止血。 |
| 给每个 worktree 建一个伪 project（复用现有 project 级全套资源） | 短期省事，但把「一个仓库」与「一个项目」两个概念焊死：session 持久化、侧栏、capabilities 白名单、agent/skill 作用域全要跟着伪装。属于用数据换抽象缺失的债。 |
| 前端按 500ms 轮询所有工作树 status | 直接违反 I1（把正确性建在时序上），且 IPC 放大 N 倍；`git-changed` 风暴期间还会与 debounce 竞争。 |
| 保留 libgit2 引擎，只把它也用于主仓（统一成「另一套」） | 双引擎的代价不止词表（D4），还在于它**没有 version 语义**、且会自己刷新 index 的风险面与 §9 的只读契约不重合。CLI porcelain 已是主链路既成事实（`worker.rs:266-277` 注释记录了为什么去掉 `--no-optional-locks` 回退分支）。 |
| 在消费侧继续加守卫（「若 X 则不覆盖」） | F4 已经证明这种守卫的判据是全局可变状态，每加一条就多一处需要人肉同步的偶然条件。本设计的判据全部落在**数据本身携带的身份**上。 |

## 6. 规模与性能预算（D-B 下）

- 常驻规模：**每项目至多一套**挂载资源（1 worker 线程 + 1 ThrottleScheduler 线程 + 1 心跳线程 + 1 git-meta watcher + 1 主文件 watcher），与工作树总数无关。
- 切换成本：`unwatch(旧) → watch(新) → 有界等待首个快照`。`notify::RecommendedWatcher` 在 Linux 上递归 watch 会遍历整树（`project/commands.rs:126-130` 注释记录过因此必须 `spawn_blocking`）→ 大仓冷启动窗口必须有实测上限（AC11③），且窗口内前端为空态而非旧数据（I1-b）。
- 单条文件变更：目标恰好 1 条 `git-status-snapshot`（对应当事单元），零跨单元重复发射。
- 内存：快照表条目数上界 = 挂载中的单元数（≤ 项目数）；每条目 entries ≤ 1000（沿用现有封顶）。
- 单一引擎代价：worktree status 从 libgit2 进程内调用改为 fork+exec；现状 worktree 每次刷新本来就要 fork 两条 `diff --numstat`（`local/status.rs:118-150`），预期净变化中性偏优（AC11 给数据）。

## 7. 测试策略（AC → 用例落点）

| AC | 自动化落点 |
| --- | --- |
| AC1 | `useGitStatusEventsSync.test.ts` 新增「聚焦风暴不污染单元槽」+ Rust `manager/tests` 双单元事件隔离 |
| AC2 | `useLocalProjects.test.ts`：B 事件 + A 激活 worktree → 两槽均不变错 |
| AC3 | `git/commands/index.rs` 集成：worktree 内 stage/discard 后该单元快照前进；`wait_status_fresh` 单元测试改为按 RepoRef |
| AC4 | `status_worker` 新增 linked-worktree fixture（`tempdir()` 派生，红线 13）+ `lifecycle_tests` 风格事件计数 |
| AC5 | `worker` 级：两单元并行信号 → 各自 version 独立、互不越槽 |
| AC6 | `path_guard` 单元测试（canonical 回传）+ `useAppShellData` 存活判定测试（符号链接形态） |
| AC7 | `useSessionBootstrap.test.ts`：恢复顺序 → 首个写入即 worktree 单元 |
| AC8 | 双入口一致性：同一 fixture 两条路径产出 entries 逐字段相等（替代 `local/status.rs` 的旧引擎用例） |
| AC9 | 新增护栏 `tools/guards/checks/`（约定式扫描：`changed_files` 写点/裸 `setState` 旁路），与 `pnpm lint`、CI 接线（参照 `check_path_identity_scope.py` 的台账模式） |
| AC10 | `useFileSelection`/`useUntrackedDirExpansion`/`aheadBehindKey` 三处跨单元不继承的断言 |
| AC11 | `lifecycle_tests` 扩展：多单元 watch/unwatch 套数与事件计数 |
| AC13 | 现有 WSL/SSH 用例全量保持，不改断言 |

## 8. 决策落点（原未决问题，2026-09-26 全部关闭）

- **Q1 → 后端出 key 字符串**。`repo_key` 由 `RepoRef::key()` 单点产出，前端只透传 + 作 map 键；前端 `repoKeyOf()` 仅用于「我即将请求某个单元」的场景，入参路径必须来自后端清单。双端各一条 golden 测试钉住同一输入 → 同一字符串。
- **Q2 → 不存在**。D-B 下每项目至多一套挂载资源，无需 LRU/K 上限。
- **Q3 → 整套退役**。`resolve_worktree_roots` / `has_worktrees` / `rearm_worktrees_if_needed` / `on_worktree_meta_changed` 的存在前提就是「worktree 没有自己的资源」；per-单元挂载后该前提消失，按 R5.2b 删除而非改造。linked worktree 的 gitdir（`main/.git/worktrees/<name>/`）由该单元自己的 `resolve_git_meta_paths` 解析，只看它自己的 `HEAD` 与 `index`。
