# S3 Git 状态入模：视图节点一等属性 + 组装期 Join

## Goal

让文件树节点在**视图模型层**携带 git 状态（`git_status` / `is_ignored`），把 git 状态从
「渲染期回调匹配」收敛为「组装期一次 join + 叶子级呈现派生」；同时以**字段等值 memo 比较器**
替换 Decoration 实例复用机制，使渲染隔离从「仅 git 刷新」扩展到「目录重载 / 展开 / 输入」
全场景。对齐调研文档公理 4（git 状态是 Entry 的属性，不是另一张列表的渲染期匹配）。

## Background

业界（VSCode / Zed / IDEA）共同公理：**git 状态是文件树节点的一等属性**。

当前实现（gitFileDecoration + publish/resolve 单例）已经在性能上达标
（O(changed) 派生 + path 键控结构等值缓存 + React.memo 截断），它的问题不是性能，
而是**模型形态**：

1. git 状态不落在任何节点上——文件树、PR 树共用一套「平行数组 → 渲染期回调解析」契约
   （`resolveNodeDecoration` / `resolveDecorationFor` props 逐层下传）；
2. 为让回调身份恒定而引入模块级单例 + 渲染期 publish（`getSharedDecorationResolver`），
   是全应用唯一的「渲染期写模块态」特例；
3. 渲染隔离只覆盖 git 快照变化一种场景——目录桶重载、展开/收起、tab 切换、
   新建输入每敲一个字符，都会因 node/expandedDirs/creatingValue 的引用变化而**整树重渲染**
   （`buildFileTreeView` 组装时对所有节点 spread，节点身份必然变化）。

> 动机修正（相对上一版 PRD）：原稿称现状为「渲染期 O(n) 匹配」，不准确——
> 现状派生是 O(changed)、解析有缓存。本任务的价值是**模型对齐 + 机制简化 + 隔离场景扩展**，
> 不是修复一个不存在的性能问题。

## Requirements

### R1: 视图节点携带 git 状态（FileNode 保持纯文件系统模型）

- 新增视图节点类型 `FileTreeViewNode = FileNode & { git_status?; is_ignored?; is_active?; is_selected?; is_expanded?; dir_state?; creating_input?; renaming_name? }`
  （实现定稿：git 投影 + 全部逐节点视图状态入模，理由见 design.md §10-1）
- `FileTreeGitStatus = 'conflict' | 'deleted' | 'modified' | 'renamed' | 'untracked' | 'added'`
  （即 gitFileDecoration 的 `DominantStatus` 提升为公开导出）
- **不改 `FileNode` 本身**：目录桶缓存是文件系统事实的模型，git 状态是覆盖层投影，
  两者不得混写（数据与信号分离；桶由 fs 事件写、git 状态由快照派生，生命周期不同）

### R2: 组装期一次 join（fileStore 不感知 git）

- `buildFileTreeView(dirs, expandedDirs, input, decorate?)` 增加视图状态输入与
  可选装饰参数：组装 walk 时把 git 语义状态（decorate）与逐节点视图状态（input）
  盖章到视图节点
- `decorate` 由 FilesPanel 从现有派生 map（fileSummaries / folderSummaries /
  collapsedDirs / ignoredSet，全部保留）构建，内部复用既有纯函数
  （提取 `resolveNodeStatus(path, isDir, inputs) → { status, ignored }`，
  `resolveDecoration` 重构为其上的呈现投影——PR 树行为零变化）
- **fileStore 零改动**：不新增 gitStatusMap / applyGitStatus / patch 逻辑。
  git 状态不写入目录桶——git 事件不得变更 fs 结构缓存

### R3: 数据接线保持现状（零跨 feature 改动）

- `changedFiles` / `ignoredFiles` props（FilesPanelWrapper → FilesPanel）原样保留：
  数据源仍是 `projectStore.git_info.changed_files`（单槽位视图，天然覆盖
  主仓库快照 / worktree / WSL / SSH 全部路径）与 `gitStore.ignoredByProject`
- 不在 useGitStatusEventsSync / refreshGitFileStates 中调用 file feature
  （feature/git → feature/file 依赖不引入）
- **`ignoredFiles` 继续作为 readDirTree 的后端剪枝输入**（读前剪枝是 S0/S1 成果，
  与灰显无关，不得拆除）

### R4: 叶子级呈现派生，删除 resolver 链

- FileTreeNode 删除 `decoration` / `resolveDecorationFor` props，
  直接读 `node.git_status` / `node.is_ignored`，
  经新导出 `statusToNameColorClass(status, ignored, isActive)` 得到名字色
  （文件树仅消费 color class——徽标/variant/dot 属于 PR 树，不在本范围）
- 删除 `getSharedDecorationResolver` / `SharedDecorationResolver` 及 FilesPanel 的
  publish/resolve 用法；`resolveDecoration` / `summaryToBadge` / `buildFileSummaryMap` /
  `buildFolderSummaryMap` / `collectCollapsedDirs` **保留导出**（PR ChangeFileTree 消费）
- 词表封闭不变：优先级链（active > conflict > deleted > modified > renamed >
  untracked > added > ignored 灰显 > 默认）仍收敛在 gitFileDecoration 单处定义

### R5: 目录聚合与折叠继承语义保持

- 目录节点状态 = `folderSummaries` 聚合（O(changed×depth)，基于 changed 全集——
  未展开的深层祖先目录也携带状态色）；deleted 不向目录传播
- 折叠 untracked 目录条目（`is_dir` entry）：目录自身携带状态 + 可见后代经
  `findInheritedCollapsedDir`（二分前缀）继承目录态色
- git 状态与 ignored 共存时状态优先（不灰化）；激活文件 accent 最高优先

### R6: 字段等值 memo 比较器（渲染隔离的承重墙）

- FileTreeNode 的 `React.memo` 改用自定义 `arePropsEqual`（实现定稿：全部视图状态
  已入模，比较收敛为「子树指纹 + depth + projectId + 稳定回调身份」，
  churn 型提交回调刻意排除，机制见 design.md §4 / §10）
- 效果矩阵（相对现状全为等或优）：

| 场景 | 现状 | 本方案 |
|---|---|---|
| git 快照变化（状态未变路径） | 0 重渲染（resolver 等值） | 0 重渲染（字段等值） |
| git 快照变化（状态变化路径） | 仅变化节点 | 仅变化节点 |
| 目录桶重载（内容未变） | **整树** | 仅内容变化节点 |
| 展开/收起 | **整树** | 新挂载子树 + 该节点 |
| tab 切换 | **整树** | 新旧激活 2 节点 |
| 新建输入每击键 | **整树** | 输入行所在 1 节点 |

## Non-Goals

- 不改 Rust 后端（readDirTree 的 ignored 剪枝参数保留）
- 不改 GitCommitPanel / ChangesList（changed_files 是其天然输入）
- 不改 PR ChangeFileTree（继续消费 gitFileDecoration 既有导出，行为零变化）
- 不做 store 层 git 状态缓存（gitStatusMap/ignoredSet 不进 fileStore——接线现状已够）
- 不做 S2 排除式监听、S4 虚拟化、fsmonitor/untracked cache 引导
- 不删除 `ignored_files` 全量数组（它同时是读前剪枝输入；删除需后端
  gitignore 感知的 readDirTree，属独立任务）

## Acceptance Criteria

- [ ] `FileTreeViewNode` 类型含 `git_status` / `is_ignored`；`FileNode` 未被修改
- [ ] `buildFileTreeView` 带 decorate 参数；组装期盖章有纯函数单测
- [ ] `resolveNodeStatus` 提取后 `resolveDecoration` 行为不变（既有 gitFileDecoration
      测试全部保持绿，含 realPayload）
- [ ] FileTreeNode 比较器单测：7 个场景的渲染计数逐一断言（含桶重载内容变化）
- [ ] 语义 parity 单测：deleted 不传播 / 目录聚合含未展开祖先 / 折叠 untracked
      后代继承 / 状态与 ignored 共存状态优先 / 激活 accent 最高优先
- [ ] FilesPanel 不再引用 getSharedDecorationResolver / resolveNodeDecoration；
      `resolveDecorationFor` prop 从 FileTreeNode 删除
- [ ] readDirTree 调用链仍传 ignoredFiles（剪枝不回退）
- [ ] PR ChangeFileTree 渲染行为与现状一致（既有测试绿）
- [ ] `pnpm type-check` + `pnpm test:run` 通过；`pnpm lint` 通过
