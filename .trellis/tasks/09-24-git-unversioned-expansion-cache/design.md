# 技术设计：untracked 目录展开缓存失效 + 快照目录内容感知

> 修订 v2（2026-09-24）：修正三处会导致返工/事故的设计缺陷（S2 信号源、S3 失败重试、B 的摘要截断），补传输层范围与开销模型，执行顺序改为 A 先行；引用逐条核实结果见 §8。
> 范围：方案 A（前端，必做且先做）+ 方案 B（后端闸门语义修正，local 专项，A 验证后独立评估）。

## 1. 现状数据流（已核实）

```
FS 变化 → notify watcher (callbacks.rs:105-112)
        → ThrottleScheduler（合并信号）→ worker.check()
        → git status --porcelain --no-optional-locks   (worker.rs:159-172)
        → [闸门: current == last_status && branch 相等 → continue]   ← ★缺陷2 (worker.rs:90)
        → parse_porcelain → GitStatusSnapshot{version+1}
        → snapshots 注册表 + emit(GIT_STATUS_SNAPSHOT_EVENT)   (manager/core.rs:97-105)

前端: useGitStatusEventsSync（version gate, projectStore.ts:24-30）
    → applyGitStatus 整体替换 changed_files
    → GitCommitPanel → ChangesList (ChangesList.tsx:65-66 groups.unversioned)
    → useUntrackedDirExpansion
        → dirFilesMap 仅首次拉取 get_untracked_files   ← ★缺陷1 (useUntrackedDirExpansion.ts:63-90)
        → expandUntrackedEntries 平铺渲染（缺失键时目录条目继续占位）
```

### 1.1 传输层差异（决定 B 的范围）

| 路径 | watcher / 事件 | status 计算 | 版本信号 |
|---|---|---|---|
| local 主路径 | 有（含 `.git` meta watcher + 30s 心跳 `manager/core.rs:307-335`） | worker（CLI porcelain，`ExecTarget::Local`） | `version` 单调递增 |
| WSL / SSH / worktree | **不挂 watcher**（`git/commands/query.rs:59-66`） | transport 兜底（`operations/files.rs:23-36`） | 恒 `version: 0`（恒放行） |

结论：缺陷 1 全类型成立；缺陷 2 与「版本前进」这一失效信号只存在于 local 主路径。B 为 local 专项，远程失效信号登记为缺口（prd.md Scope / AC9）。

## 2. 方案 A：前端展开缓存可失效

### 2.1 契约变更（`useUntrackedDirExpansion`）

`dirFilesMap` 增加失效通道，三条信号：

| 信号 | 触发源 | 行为 |
|---|---|---|
| S1 文件事件 | `useFileChangedEvent`（`FILE_CHANGED_EVENT`，载荷 `{project_id, paths}`，`watcher/debounce.rs:121-130`） | `paths` 中任一路径落在某缓存目录前缀下 → 标记该目录需重拉（**待实现**：AC7-1～AC7-3 即其红灯） |
| S2 快照替换 | `files`（= store `changed_files`）**引用被替换** | 已展开目录全部标记为需重拉；已不在目录集里的键丢弃（**已实现**） |
| S3 失败重试 | 拉取失败的条目 | 不写缓存键（目录条目继续占位），下一次失效信号/刷新重试；带退避防自激（§2.5，**待实现**） |

**S2 为什么是「引用被替换」而不是「version 前进」（v1/v2 的判断被证伪）**：v2 以「快照 `version` 前进」为主信号、仅 `version <= 0` 才退化用引用。落地前核实发现 local 主路径的两条刷新**都不推进 version**：

- 面板刷新按钮 → `ProjectCommands.refreshGitInfo()` → `invoke('get_git_info')`（`commandFactory.ts:24`、`projectApi.ts:41`）—— 完全不经过 version gate，也不写登记表；
- 窗口聚焦 / `git-changed` 兜底 → `refreshGitFileStates` → `versionGateAccepts(projectId, version, allowEqual=true)`（`gitStatus.ts:79`）—— 同版本放行，登记值不变。

而这两条正是「用户主动刷新后必须看到最新目录内容」（AC3）的路径，且**恰恰是缺陷 2 未修时唯一能自救的通道**（快照本身陈旧）。所以失效判定必须落在「引用被替换」，版本号不参与失效判定。AC7 的调用次数上界仍成立：每次替换 = 1 个批次 ⇒ 总调用 ≤ 折叠目录数 × 批次数。

**S2 的两条前置契约（缺一即退化为「每次 render 都重拉」）**：

1. **上游 `files` 引用必须稳定**：`useCommitPanelDiffStats` 原先把 `changedFilesWithStats` 写成每次 render 重建的 `.map()`（`useCommitPanelAux.ts:63`），会让 `ChangesList` 的 `files` 每次 render 换引用 → 提交框每敲一个键都触发一轮重拉（同时 `ChangesList` 的 `React.memo` 也失效）。本次已加 `useMemo`（依赖 `[changedFiles, diffStats]`）并在代码注释里把它标为**契约**。
2. **缓存作用域必须随项目重置**：`dirFilesMap` 以目录 path 为键，`GitCommitPanel` 跨项目不重挂载 ⇒ 同项目切换后旧项目子行会显示到新项目的同名目录下。本次给 `ChangesList` 加 `key={project.id}`（渲染侧重置），hook 因此无需感知 projectId。

**SWR 语义**：S2 标记 stale 时**保留旧值**（子行不闪回目录占位），新值落地才替换 —— 否则每次刷新/聚焦都会让已展开的目录闪一下目录条目。

**版本登记表的处置**：`versionGateAccepts` 的登记表从 `projectStore` 模块级 Map 搬进 store state（`statusVersionByProject`，语义不变、`version<=0` 不入表）—— 消除「同一事实模块级 Map + UI 状态两份表示」的隐患。**它不参与本次失效判定**（理由见上）；保留它是为「B 落地后『版本前进 ⇔ 内容确实变了』可用来跳过无谓重拉」这一优化留口径，届时应带实测数据再决定是否启用。

### 2.2 防抖与去重（已实现）

- 并发去重沿用 `inflightDirsRef`；**stale 在本轮拉取开始时清除**，因此飞行期间到达的失效会被重新标记 → 落地后合并为一次 trailing 重拉（AC7-3）。
- `staleDirs` 用 state 而非 ref：失效信号本身需要触发一次渲染，拉取 effect 才会重算 pending；所有 `setState` 都**判等后回原引用**（`setDirFilesMap` 无键被丢弃时回 `cache`、`setStaleDirs` 内容未变时回 `prev`）——这是 §2.5 自激的必要条件之一。
- 失效本身只改 Set，无 IO，不需要时间去抖（真正的去抖在后端 `file-changed` 的 200ms 滑动 / 1.5s 上限窗口，`watcher/debounce.rs:59-62`）。
- **引用稳定性契约（实测踩坑）**：S2 以 `files` 引用为信号，故上游**必须** memo；否则每次渲染都会被判成「快照替换」→ 持续重拉（实测：测试里传内联数组字面量时 1s 内 26k 次调用）。生产链已逐层 memo（store `changed_files` → `GitCommitPanel.changedFiles` → `useCommitPanelDiffStats.changedFilesWithStats`），测试同样必须传稳定引用。

### 2.3 失败语义修正（已实现）

现状是**双层失守**：

- `GitCommitPanel.tsx:173-183` 在 handler 内 `try/catch` → `onShowToast` + `return []`，把失败伪装成「空目录」；
- 因此 hook 的 `catch`（`useUntrackedDirExpansion.ts:76-78`）**是死代码**，异常永远到不了 hook。

落地（失败语义沿调用链显式化）：

1. `GitCommitPanel` 的 handler 失败时 **toast 后 rethrow**（不再 `return []`）—— 把「拉取失败」与「目录真的为空」区分开；
2. hook 侧 catch → **不写缓存键**（目录条目继续占位，`expandUntrackedEntries` 的 fallback 分支天然生效）+ 记入 `failedDirsRef` 失败抑制；
3. 失败抑制在**下一次失效信号**（S1 命中该目录 / S2 任一刷新）时复位 → 重试；**无自发定时重试**（AC4 的「静默窗口内至多 1 次」由此成立）；
4. toast 频次由 (3) 天然封顶（抑制期内不会再发起拉取），因此不需要额外的 toast 去重状态。

### 2.4 API 形状

- 签名**不变**：`useUntrackedDirExpansion(files, onExpandUntrackedDir)` —— 失效信号直接取自 `files` 引用（已在入参里），**不需要**新增 prop 或 version 透传（v2 初稿的第三参数 `appliedVersion` 已废弃，见 §2.1）。
- v1/v2 的「`ChangesList.tsx` 零改动」分两半看：`GitCommitPanel` 的 `handleExpandUntrackedDir` 已改（§2.3 的 rethrow）；`ChangesList` 未新增 props，只在 `GitCommitPanel` 侧补了渲染键 `key={project.id}`（缓存作用域，见 §2.1）。
- 前缀判定用路径段语义（红线 12）：`path === dir || path.startsWith(dir + '/')` 落在 hook 内的纯函数 `isPathUnderDir`（导出以便单测），禁止 `endsWith('/' + p)` 之类的别名匹配。

### 2.5 防自激（v1 遗漏的事故点，已按三条必要条件落地）

v1 的「失败不写缓存键」在当时的代码结构下会形成 **IPC 风暴 + 错误 toast 刷屏**：

```
拉取失败 → 不写 dirFilesMap
       → setDirFilesMap({...prev}) 产生新对象（:84-88）
       → effect 依赖 dirFilesMap 变化 → 重跑
       → 该目录不在 map 中且非 inflight → 再次拉取 → 再失败 → …
```

三条必要条件（已全部实现，见 `useUntrackedDirExpansion.ts`）：

- **不写键 ≠ 反复重试**：失败目录进入 `failedDirsRef` 抑制，pending 判定把「抑制中」视为非 pending；抑制只在失效信号到来时复位。全失败时 `setDirFilesMap` 不回写（`succeeded.length === 0` 直接返回）。
- **所有 state 更新判等回原引用**：`setDirFilesMap`（无键被丢弃回 `cache`）、`setStaleDirs`（内容未变回 `prev`）。
- **第二类自激（实测新增）**：S2 以「`files` 引用变化」为信号，若上游每次渲染换引用，则「hook 内部 setState → 重渲染 → 新引用 → 再失效」形成闭环（实测 1s 内 26k 次拉取）。故 §2.2 的引用稳定性契约是**必要条件**，不只是性能优化。

## 3. 方案 B：status 快照感知折叠目录内容变化（local 专项）

### 3.1 探测策略（已实现）

闸门在 porcelain + branch 相等的前提下，追加折叠目录内容摘要比较：

```
status_unchanged = porcelain 相等 && branch 相等
digest_unchanged = digest 已知 && digest == last_collapsed_digest
status_unchanged && digest_unchanged → continue（不 emit）
其余 → emit（含 digest Unknown / 首次探测）
```

- **摘要无条件计算**（偏离 v2 初稿）：v2 计划「porcelain 不等时跳过探测」以省一次枚举，但那样 emit 后就无法把 `last_collapsed_digest` 写成「当前状态」，下一次快路径会拿陈旧值比较 → 多 emit 一次（spurious）。emit 本就是实质变化、频率可控，故接受每次 check 一次枚举。v2 计划的测试 `probe_skipped_when_porcelain_changed` 相应取消。
- `Digest::Known { dirs, files, hash }`：`hash` 覆盖「目录相对路径 + 该目录 `ls-files -z` 的**原始输出字节**」→ 目录重命名、目录内文件增删、嵌套子目录内新增都能被看见；**只改文件内容不改集合则摘要不变**（负面对照测试钉死：Unversioned 行不展示行数，无需重发快照）。
- **禁止截断**（v1 的错误）：不复用展示层的 500 条截断（`operations/files.rs:63-70`）—— 截断后第 501 条起的变化永远不改变摘要 → 漏发。改为上界 `MAX_PROBE_BYTES = 8 MiB`，**超限即 `Unknown` 放行**（宁可多发，不可漏发）。
- 枚举命令：`git -C <repo> --no-optional-locks ls-files --others --exclude-standard -z -- <dir>`（与前端展开同一条命令；`--no-optional-locks` 必须位于子命令之前，避免探测顺手刷新 index 形成自反馈回路），走 worker 线程上的同步桥 `collect_blocking`（worker 是独立 OS 线程，红线允许）。
- **未与命令层共享枚举函数**（偏离 v2 初稿 §3.4）：命令层是异步 + transport 抽象（`transport.run_git_opts`），worker 是同步 + 仅 local（`collect_blocking` 同步桥）；强行共享要为一次 git 调用引入 async↔sync 适配层，复杂度不抵收益。两处各自持有对同一条 git 命令的调用（第 2 次出现，未达 DRY 的 3 次阈值），共享的是**语义**（两侧注释互相指引）。

### 3.2 开销（实测，取代 v2 计划的 mtime 前置短路）

实测（本机 macOS，2026-09-24；`ls-files --others --exclude-standard -z -- <dir>` 跑 5 次，取 min/avg）：

| 目录规模 | min | avg | 输出字节 |
|---|---|---|---|
| 3 个文件 | 15.1 ms | 15.6 ms | 39 B |
| 10,000 个文件 | 23.8 ms | 24.0 ms | 138,890 B |

结论：

- 成本由**进程启动**主导（≈15 ms），1 万文件仅多约 9 ms；10k 文件输出 ≈ 139 KB，即 8 MiB 上界约 **50 万文件**才触发 —— `Unknown` 属病态场景，不会退化成「每次 check 都 emit」的 churn。
- 探测发生在 **worker 专属 OS 线程**上（不是 UI/IPC 线程），且只在折叠目录存在时有实际开销（折叠目录天然稀疏：常见 0–5 个）。
- 因此 v2 计划的 **mtime 前置短路取消**：它本身带嵌套洞（顶层目录 mtime 不随 `dir/sub/` 内新增而变，而嵌套新增必须被看见），收益（省 ~15 ms/目录/次，且在 worker 线程）不抵正确性风险与额外状态。
- 若将来实测发现高频事件下成本显著，正确方向是**把 watcher 的变更路径作为 hint 传入 worker**，仅当命中折叠目录前缀时才探测（零 git 调用、无嵌套洞），而不是 mtime。

### 3.3 闸门语义（已实现）

- 首次探测（`last_collapsed_digest == None`）→ `Some(digest) == None` 为假 → 正常 emit。
- 目录在两次 check 间整个消失/新建：porcelain 字符串本身变化，走原有分支，无特殊处理。
- 探测失败（git 报错、目录被并行删除）或超出上界：`Unknown` → 放行 emit；`Unknown` 与「已知相等」由**枚举**区分，不用哨兵值。
- `Unknown` 长期化的代价已被上界实测压住（见 §3.2）：只在 ≳50 万文件的病态目录出现。

### 3.4 代码落点（已实现）

| 内容 | 位置 | 状态 |
|---|---|---|
| 探测 + 摘要 | **新文件** `common/git/status_worker/collapsed_probe.rs` | ✅ 6 条单测（含「不截断」与「只改内容不变」两条契约） |
| 闸门改造 | `worker.rs` 主循环（`status_unchanged && digest_unchanged` + `last_collapsed_digest`） | ✅ 3 条测试：batch 风暴 emit 1 次、内容不变不 emit、原有两测试保持绿 |
| 枚举 | `collapsed_probe.rs` 内部（同步桥） | ✅ 未与命令层共享（理由见 §3.1） |

Event 名不新增：继续 `GIT_STATUS_SNAPSHOT_EVENT`。命令层零改动（`get_untracked_files` 行为不变）。IPC 条目数与折叠语义不变。

## 4. 传输层范围与缺口

- 本次只覆盖 local 主路径（含 worktree 未激活态）：那里的展开陈旧由 A 的 S1/S2 修复，闸门盲区由 B 修复。
- WSL / SSH / worktree 激活态：无 watcher → 无 `file-changed`；读接口 `version: 0` → S2 退化为 S2'（引用身份）。即：**手动刷新可恢复一致性（AC3），但目录内变化不会自动出现（AC1/AC2 在远程不满足）**。
- 缺口登记：远程自动失效需要独立信号（例如远程侧轮询摘要、或复用 transport 的 `get_worktree_changed_files` 轮次），不在本次范围；AC9 只要求不回归。

## 5. 方案经济性与备选

### 5.1 先 A 后 B

折叠目录条目在 porcelain 中**确实没有变化**，面板陈旧几乎全部来自缺陷 1 → **A 单独落地即可满足 AC1/AC2/AC3 的用户可见需求**。B 的真实增量是：

1. **watcher 丢事件时的自愈**（30s 心跳 + 摘要 → version 前进 → S2 逐出）；
2. **闸门语义正确性**：闸门声称「无变化」但 untracked 集合已变，任何读快照的消费者（`git/commands/query.rs:59-79` 读接口）都会拿到陈旧数据。

这两条成立，但相对 B 的代价（worker 热路径增加 git 子进程、闸门语义变更、新纯函数 + 测试面）应独立评估。故：**A 先行 → Step 2 端到端验证 → 决策点 D1 决定 B 是否并入本次**；若 D1 判定 A 已够，B 另开任务按「闸门语义修正」立项（附带 §3.2 的实测数据）。

### 5.2 备选：内容寻址缓存（一份数据两用）

若接受在 `FileChange` 上增加一个 additive 的目录内容 token（`is_dir` 已是同类先例，`writer.rs:50-62`）：

- 前端缓存 key = `${path}:${token}`，命中即用、未命中即拉 → **精确失效**，天然覆盖 S1/S2/S2'/S3 的全部逻辑（无需事件订阅、无需全量逐出、AC7 自动成立）；
- B 的摘要一次计算两用（喂闸门 + 进载荷）；
- 代价：IPC 载荷加字段（跨 local/remote 需 transport 侧同样产出，否则远程 token 恒空 → 退化为现状）、`FileChange` 全链路序列化面变大。

本次不做（prd.md Non-Goals），仅在 D1 若判定「B 值得做」时作为 B 的实现形态候选比较。

## 6. 兼容性与回滚

- **payload 兼容**：`GitStatusSnapshot` / `FileChange` / `get_untracked_files` 返回类型全部不变（§5.2 备选未采用）。
- **行为兼容**：折叠语义、stage/discard/diff 全链路不变。
- **A 回滚**：hook + `GitCommitPanel` handler + `ChangesList` 传参三处可单批 revert，UI 无耦合。
- **B 回滚**：闸门去掉 digest 条件即回原语义；新文件 `collapsed_probe.rs` 整体删除。无数据迁移。
- **降级**：探测失败 → `Unknown` 放行（多发快照），不阻断主链路。

## 7. 权衡记录

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 执行顺序 | A 先行，B 在 D1 决策点评估 | 一次做完 A+B | A 单文件级、可独立验证；B 动热路径，收益（心跳自愈 + 闸门语义）需实测支撑（§5.1） |
| S2 失效信号 | `files` 引用被替换（覆盖快照事件 / 刷新按钮 / 聚焦刷新全部路径） | 等快照 `version` 前进 | local 两条刷新都不推进 version（刷新按钮不经 gate、聚焦走 `allowEqual`）→ 等版本 = AC3 不可达；引用替换按批次计，AC7 上界仍成立（§2.1） |
| S2 的前置契约 | 上游 `files` 引用稳定（`useCommitPanelDiffStats` 加 memo）+ 缓存随项目重置（`ChangesList` 的 `key={project.id}`） | 每次 render 重建引用 / 跨项目复用缓存 | 前者退化为「每次 render 都重拉」且 `React.memo` 失效；后者把上一项目的子行显示到新项目同名目录下（§2.1） |
| 版本登记表落点 | 搬进 `projectStore` state（`statusVersionByProject`），`versionGateAccepts` 为唯一写入点 | 在 `gitStore` 另建 per-project map；或沿用模块级 `appliedStatusVersion` | 后者两份表示（归一原则）、或渲染期不可响应式；搬进 state 后单一表示 + 可订阅（§2.1） |
| 失败语义 | 调用方可判别回传 + 不写缓存键 + 退避 | 缓存 `[]` + TTL | 空数组会被 `expandUntrackedEntries` 消费成「0 文件」误导用户；但「不写键」必须配判等 + 退避，否则自激（§2.5） |
| B 的摘要输入 | 流式摘要（不物化路径列表、不截断） | 复用展示层 500 截断 | 截断会让超限目录的后续变化漏发（§3.1）；流式同时避免历史上「条目爆炸进内存」的同类风险 |
| 探测时机 | 仅 porcelain 相等（快路径）+ mtime 短路 | 每次 check 全量探测 | 探测成本 ∝ 目录内文件数，热路径上必须降频（§3.2） |
| B 是否展开进快照 | 否，只喂比较闸门 | 把子文件并进 entries | 后者违反 IPC 上界公理（红线 4）与折叠测试契约 |
| 载荷扩展 | 本次不做（备选 §5.2 登记） | `FileChange` 加目录 token | token 方案更简洁，但改载荷形状 + 需远程 transport 同步产出，本次范围外 |

## 8. 引用核实记录（2026-09-24）

| v1 论断 | 核实结果 |
|---|---|
| `useUntrackedDirExpansion.ts:63-90` 缓存永不失效 | ✅ 属实（:65-68 pending 仅判 `undefined`；:52 为纯 `useState`） |
| `useUntrackedDirExpansion.ts:76-78` 失败缓存 `[]` | ⚠️ 代码属实，但该 `catch` **是死代码** —— 调用方 `GitCommitPanel.tsx:173-183` 已自行 catch 并返回 `[]` |
| 折叠语义测试在 `local/status.rs:48-51` | ❌ 更正：48-51 是注释，测试在 `local/status.rs:283` |
| `worker.rs:90-92` 闸门 | ✅ 属实（条件为 porcelain **且 branch**，非单条件） |
| worker 跑在 OS 线程 + 30s 心跳 | ✅ 属实（`worker.rs:23-51` 独立线程 + 同步桥；`manager/core.rs:307-335` 10s×3） |
| 手动刷新也只更新外层 status | ✅ 属实且因果完整（`gitStatusEventsSync.ts:168-175` → `gitStatus.ts:58-103` → `query.rs:59-79` 优先返回 worker 快照） |
| B 探测输入与 `get_untracked_files` 同源 | ✅ 属实（`operations/files.rs:44-71`，含 500 截断 —— 故 v2 明确禁止探测侧复用该截断） |
| `is_dir` 契约可用 | ✅ 属实（`writer.rs:50-62` + `FileChange.is_dir`） |
| 闸门/心跳覆盖范围 | ⚠️ 补正：worker 硬编码 `ExecTarget::Local`，WSL/SSH/worktree 不挂 watcher 且 `version: 0`（`query.rs:59-66`）→ v2 增加传输层范围（§4） |
