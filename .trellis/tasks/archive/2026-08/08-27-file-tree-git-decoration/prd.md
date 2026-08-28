# 文件树 Explorer 装饰层重构：结构/装饰/渲染三明治 + GitSummary 单子目录聚合

## 问题陈述（Why）

### P1 目录不显示 git 状态【用户可感知 · 本次核心价值】

改了 `src/features/git/utils/gitStatus.ts` 这类深路径下的文件后，左侧 Explorer 里 `src`、`features`、`git` 等**目录没有任何视觉提示**，用户必须在层层折叠的树里逐个展开才能定位改动文件。

业界三家全部支持目录级状态提示：

| | VSCode | Orca | Zed | **Neeko** |
|---|---|---|---|---|
| 目录名着色 | ✅ | ✅ | ✅ | ❌ |
| 目录行尾徽标 | ✅ 字母 | ✅ 字母 | ✅ 字母 | ❌ |
| 聚合语义 | 向上遍历+优先级合并 | `buildFolderStatusMap` 向上累加 | sum-tree 单子区间摘要 | 无 |

**根因**：`FileTreeNode.tsx` 只按 `node.path` 查 `changedFilesMap`（纯文件级命中），不存在任何祖先聚合逻辑。

### P2 状态展示词汇分裂，两处定义互相矛盾【一致性缺陷 · 已发生的 bug】

同一个 git 状态，两个组件展示**颜色不一致**：

| status | 主 Explorer（FileTreeNode.tsx） | PR 变更树（FileTree.tsx） |
|---|---|---|
| Modified | blue | yellow |
| Renamed | blue | yellow |
| Untracked | red | blue |

**根因**：`STATUS_TEXT_COLOR` 在 `FileTreeNode.tsx` 与 `FileTree.tsx` 各定义了一份，无单一事实源；后续修一处漏一处。

### P3 git 高频刷新触发全文件树重渲染【性能 · 与近期 perf 工作直接相关】

`FileTreeNode` 是 `React.memo` 组件，但接收 `changedFilesMap: Map` prop。build/编辑期间 `git-changed` 事件风暴驱动 `refreshGitFileStates` → 每次派生出新 `Map` 引用 → **所有已渲染节点的 memo 浅比较全部失败**，整棵已展开树重渲染。

**根因**：装饰以「整张 map」为粒度下传，而 memo 需要的是「单节点装饰值」粒度的稳定性。仓库近期连续做性能收敛（status payload cap、定向树刷新、忽略目录剪枝），本问题是同一条性能线上的遗留缺口。

### P4 结构与装饰融合的反模式已经在 PR 树发生【架构债】

`FileTree.tsx::buildTree(files)` 把 `file: FileChange` 直接挂进 `TreeNode`：
- git 状态一变 → 整棵变更树重建，无法独立 memoize；
- 未来每加一种装饰（LSP error badge、dirty 标记），都要同时改 `TreeNode` 类型与多个消费组件；
- 与主 Explorer 的 overlay 形态分叉，同一概念两套实现。

**根因**：「树结构」与「路径装饰」这两个正交维度被压进了同一个模型。主 Explorer（`dirs` 缓存 + `buildFileTreeView`）已走在正确的分离路线上，但装饰侧仍是散落的 prop 灌入而非第一类抽象。

## Goal（对问题的回应）

把「装饰」提升为 Explorer 的第一类概念——一个 `path → Decoration` 的纯函数投影，与树结构正交分离、独立 memoize：

- **解 P1**：参照 Zed `GitSummary` 单子思想（不移植 sum_tree），新增目录摘要折叠，目录显示 git 状态（着色 + 徽标）。
- **解 P2**：状态词汇（labels/colors/优先级/labelClass/badge）收敛到唯一模块。
- **解 P3**：节点改为接收解析后的稳定 `Decoration` 值，memo 按「单节点装饰值」生效。
- **解 P4**：删除融合点，PR 树与主 Explorer 共用同一装饰投影。

### 方案选型依据（调研结论，设计细节见下）

| 维度 | VSCode | Orca | Zed | Neeko 采用 |
|---|---|---|---|---|
| 状态存放 | FileDecorationProvider 缓存 map | 前端派生 Map ×2 | 独立 `SumTree<StatusEntry>` 持久化结构 | 前端派生 Map（Orca 形态） |
| 结构/状态关系 | overlay | overlay | 两个正交持久化结构 + 游标 zipper | overlay + 纯函数投影 |
| 目录聚合 | 向上遍历+优先级短路 | `buildFolderStatusMap` O(Σ深度) | monoid 区间摘要 O(log n) | monoid 折叠语义，Map 实现，O(Σ深度) |
| 聚合产物 | letter+color | 单一主导 status | **`GitSummary` 聚合（保留 staged/unstaged 计数）** | `GitSummary` 聚合 |
| 展示词汇 | 一套 provider | 两处重复 | 一对共享纯函数 | 收敛为一对纯函数 |

明确**不做**（YAGNI 边界）：sum_tree/持久化数据结构移植（Zed 需要 O(log n) 因其维护全仓库状态；Neeko 只需已展开树）；装饰注册表/provider 插件机制（VSCode 为第三方扩展而生）。

## Requirements

> 每条需求标注所解决的问题；P1/P2/P3/P4 见问题陈述。

### R1 新建装饰模块 `src/shared/utils/gitFileDecoration.ts`【解 P1 P2 P4】

> 模块落位说明（导入防火墙约束）：git 状态词汇的消费方横跨三层——主 Explorer（features/file）、PR 变更树（`shared/components/ChangeFileTree.tsx`，被 features/git 的 PRFileTree 间接消费）、未来 tab-bar。若落在 features/file 将迫使 shared/components 反向依赖 feature 内部实现，违反仓库分层红线，故定位于 `shared/utils`。

单一公开面，导出：

1. 类型：
   - `GitStatusSummary`：`{ staged: TrackedCounts; unstaged: TrackedCounts; untracked: number; conflict: number }`，其中 `TrackedCounts = { added: number; modified: number; deleted: number }`。可加（monoid）：提供 `addSummary(a, b)` 与 `zeroSummary()`。
     - **临时语义标注**：Rust 当前输出单一 status，映射时确定性地落入 `unstaged` 桶（`Added→added`、`Modified/Renamed→modified`、`Deleted→deleted`），`staged` 恒为 0、`conflict` 常驻语义——禁止把桶位解释成真实暂存状态；后端升级后字段即自然生效。
   - `Decoration`：`{ color?: string; badge?: string; tooltip?: string; dimmed?: boolean }`（badge 取值 `'M' | 'A' | 'D' | 'R' | 'U' | '!'`）。
2. 纯函数：
   - `buildFileSummaryMap(changed: FileChange[]): Map<path, GitStatusSummary>` —— 文件级聚合（同 path 多条目合并）。
   - `buildFolderSummaryMap(fileSummaries): Map<dirPath, GitStatusSummary>` —— 对每个变更文件按 `/` 分段向上累加祖先目录（含根）；deleted 不向目录传播（对齐 Orca `shouldPropagateStatus`）。← **P1 的直接实现**
   - `resolveDecoration(path, isDir, fileSummaries, folderSummaries, ignoredSet, isActive): Decoration | null` —— 文件取自身摘要、目录取文件夹摘要，映射为颜色/徽标/dimmed；**ignoredSet 判定必须沿祖先链逐级上行匹配**——`9dbd7255` 已对忽略目录做剪枝，深层后代可能不在集合内，仅自查命中必漏，语义需等价于现有 `FileTreeNode.parentIgnored` 继承谓词（该 prop 随本次删除）。
   - `summaryToBadge(summary): { badge: string; variant: StatusVariant } | null` —— 优先级 `conflict(!) > deleted(D) > modified(M) > untracked(U) > added(A)`（对齐 Zed `git_status_indicator`）。
   - `summaryToLabelClass(summary, ignored, active): string` —— 文件名着色 class，优先级 `conflict > deleted > modified > added/untracked > ignored(dimmed) > 默认`（对齐 Zed `entry_git_aware_label_color`）。
3. 不依赖 React、不依赖 store（纯函数，100% 单测覆盖）。
4. **词表封闭约定**：消费方（文件树 / 变更树 / 未来 tab-bar 等）只允许调用本模块导出的函数与类型（`summaryToBadge` / `summaryToLabelClass` / `resolveDecoration` 等），**禁止任何组件私持 STATUS 颜色或徽标对照表**——这是防止词汇再分裂为两处定义的结构性保证。

### R2 主 Explorer 接入（FilesPanel/FileTreeNode）【解 P1 P3】

1. `useFilePanelState` 中 git 派生逻辑（`changedFilesMap`/`ignoredSet` useMemo）移出，替换为对本模块的调用；hook 瘦身只保留交互状态（展开/选中/新建/重命名/右键菜单）。
2. 装饰解析的归属与稳定化机制【P3 的直接实现 · 验收前置】：
   - **唯一归属**：FilesPanel 层经 `useMemo` 从本模块派生 `fileSummaries` / `folderSummaries` / `ignoredSet`（输入不变则引用不变），是全应用唯一解析入口；hook 内不再自行拼装原始 Map；
   - **引用稳定**：模块提供跨快照的实例复用缓存——新输入下重新解析时，结构等值（color/badge/dimmed/tooltip 全等）的 Decoration 必须**沿用上一个实例**，保证未受影响节点的 props 浅比较持续命中 `React.memo`（无此机制则每次刷新所有节点拿到新对象、memo 全军覆没）；
   - **下传策略**：递归组件中由父级解析每个直接子节点的装饰值后逐一传入子行组件；不再下传整张 map 或祖先谓词；`changedFilesMap` / `ignoredSet` / `parentIgnored` 三个 props 删除，未受影响节点在 git 高频刷新期间完全不重渲染（render count 断言兜底）。
3. **目录节点显示 git 状态**：文件夹名着色（需求演进：人工验证后明确不渲染行尾徽标，颜色即状态语言；badge 仅保留给 PR 变更树）。← **P1 的用户可见交付**
   - 折叠 untracked 目录的后代继承：Rust 不递归 untracked（单条目输出尾斜杠路径），已展开可见的深层后代经 `collectCollapsedDirs` 前缀匹配继承目录态色。
   - ignored 装饰数据链路补全：bootstrap 恢复激活项目/快照缺失时按需拉取 `ignored_files`（与 changed 解耦、一次性成本），`ignoredSet` 空缺时 dimmed 永不生效的问题就此修复。
   - **架构修正（实机验证发现）**：ignored 寄生于 `Project.git_info` 不可靠 —— Rust `GitInfo` 无此字段，项目列表刷新（`loadProjects`）等路径会用 Rust 返回值整体重建 git_info，把补拉成果洗掉（表现为 ignoredCount 恒 0，且 changed 数据因事件流掩盖而显得正常）。已迁移至 `gitStore.ignoredByProject` 独立状态：bootstrap 补拉 / `refreshGitFileStates(includeIgnored)` 写入，`FilesPanelWrapper` 与 `useFileView`（剪枝链路）改读 gitStore；`GitInfo.ignored_files` 类型字段与 merge 继承逻辑退场。
4. 删除 `FileTreeNode.tsx` 内部 `STATUS_TEXT_COLOR` 定义与逐节点 map 查询逻辑。← **P2 收敛**

### R3 PR 变更树去重复化（`features/file/components/FileTree.tsx` / `shared/components/ChangeFileTree.tsx`）【解 P2 P4】

1. 删除 `FileTree.tsx` 内 `STATUS_BADGE` / `STATUS_TEXT_COLOR` 重复定义，改用 R1 模块（含修正其与主树的色彩冲突）。
2. `buildTree(files)` 不再把 `file: FileChange` 融进 `TreeNode`（消除融合反模式）；渲染时按 path 从装饰投影取值。← **P4 的直接实现**
3. 展示语义保持不变（M/A/D/R/U 徽标 + 文字着色）。

### R4 Tab 徽标共用（可选延展，默认本期不做）

`entryGitAwareLabelColor` / `summaryToBadge` 设计上可供 tab-bar 复用；本期不接入 tab-bar，仅在模块文档注明扩展点（避免范围膨胀）。

## Non-Goals

- 不改 Rust 后端契约（`changed_files`/`ignored_files` IPC 形状不变）。
- 不做 staged/unstaged 分离展示（Rust 侧当前是单一 status；`GitStatusSummary` 先以计数归一承接，未来后端升级时无需前端重新建模）。
- 不引入虚拟滚动（与装饰正交，另行立项）。
- 不做装饰注册表/插件机制。

## Acceptance Criteria

**功能（对应 P1）**

- [x] 目录节点显示 git 状态（仅着色，无行尾徽标——人工验证后的需求演进），折叠/展开行为正常
- [x] 折叠 untracked 目录内的深层文件继承目录态色（collectCollapsedDirs 前缀匹配）
- [x] 被忽略的文件/目录灰色显示（dimmed），依赖启动补拉链路
- [ ] 手工验证：修改深层文件后，各级祖先目录呈现聚合状态

**纯函数质量（支撑 P1）**

- [ ] `gitFileDecoration.ts` 100% 单测覆盖：空输入、单文件、深层嵌套目录聚合、多状态优先级、deleted 不向目录传播、ignored 与变更共存、conflict 最高优先
- [ ] 补充用例：忽略祖先上行匹配（深层文件位于被剪枝忽略目录内仍 dimmed）；未展开的深层祖先目录也携带摘要；同输入快照两次解析返回**同一 Decoration 实例**，status 变化后仅变更路径产出新实例（引用稳定性回归护栏）

**性能（对应 P3）**

- [ ] git 状态刷新时未受影响节点不重渲染（render count 断言 memo 生效）

**一致性（对应 P2）**

- [ ] `STATUS_TEXT_COLOR` / `STATUS_BADGE` 全仓唯一来源；grep 无残留重复定义
- [ ] 同一 status 在主 Explorer 与 PR 变更树颜色一致

**架构（对应 P4）**

- [ ] `FileTree.tsx` 的 `TreeNode` 不再携带 `file: FileChange`
- [ ] `useFilePanelState` 不再包含 git 派生逻辑

**回归与门禁**

- [ ] 主 Explorer 与 PR 变更树展示回归一致（人工过一遍 + 既有测试全绿）
- [ ] 质量门禁全绿：`pnpm lint` / `pnpm lint:fe` / `pnpm type-check` / `pnpm test:run`

## Notes

- 分期建议：R1（纯函数+测试）→ R2（主 explorer 接入，核心价值）→ R3（PR 树收敛）→ R4（tab 徽标，可另开子任务）。
- 颜色 token 复用现有 `text-accent-*` 系列。需求演进（实现期人工验证反馈）：初版对齐 Zed（Modified=yellow/Untracked=blue），最终按用户提供 JetBrains 官方文件状态色表逐项对齐——Added=green(#62CC47)、Modified/Renamed=blue、Untracked(Unversioned)=砖红(#D1675A，新增 token `--accent-brick`，三主题各配值，与 accent-red 区分 Conflict)、Deleted=orange(现有 `--accent-orange`)、Conflict=亮红(accent-red)、Ignored=灰。badge/variant 保留 diff 徽标体系（M/A/D 黄绿红，PR 变更树消费）。统一后以 `summaryToLabelClass` 的优先级序列为准。
- 若后续接 LSP error badge，只是 `resolveDecoration` 多一路输入信号，不改架构。
- 后续候选任务（本期 Non-Goal）：explorer 模型融合——装饰 join 上移至模型写入路径、刷新收敛为单调度器、Rust 侧增量事件流（如 `explorer-tree-delta`）。触发条件：join 成本可感知，或接入更多装饰信号源（LSP error、dirty 标记等）。在此之前业界同类（VSCode provider 形态、Orca 渲染期投影）均为可接受稳态。
