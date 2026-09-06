# S3 Design: Git 状态入模（视图模型 + 组装期 Join）【实现定稿】

> 本版为**实现完成后的定稿**，含实现期修正（标注「实现修正」）。
> 上一版设计的「store patch 桶」机制已在方案评审轮否决，替代方案（组装期 join +
> 字段等值 memo）经实现验证落地。实现期又修正了两处设计误判，见 §10。

## 0. 方案定案与否决理由

### 决定性事实（代码验证）

1. **`buildFileTreeView` 组装时对所有节点 spread**：任何使 `dirs` 引用变化的写入
   （包括 patch 桶）都会触发组装重跑 → 整树节点换身份 → 默认 memo 全部失效。
   patch 桶买不到渲染隔离；要买到隔离必须另加字段等值比较器——而比较器一旦存在，
   patch 这一步就是多余的。
2. **文件树对 Decoration 的全部消费是一个 color class**（目录行尾徽标已按需求演进
   移除）。「状态入模」所需承载的语义很轻：一个语义状态枚举 + 一个 ignored 布尔。
3. **数据接线已经收敛**：`changedFiles` prop 的来源是
   `projectStore.git_info.changed_files`（单槽位视图），由快照事件与
   `refreshGitFileStates`（worktree / WSL / SSH 兜底）两条路径写入，
   天然覆盖所有视图场景——不需要新的 store 与事件接线。

### 候选对比

| 候选 | 结论 | 理由 |
|---|---|---|
| A. store patch 桶节点（最初设计） | **否决** | ① git 事件写入 fs 结构缓存，违反数据/信号分离；② 因事实 1 仍需比较器才能隔离，patch 变成纯开销；③ 折叠目录后代继承、目录聚合需在 store 里重写为变更式逻辑——放弃已测试的纯函数，回归风险最大；④ 需 owner 门控、reset 挂接、双数据源汇入、loadDir 回盖章四套接线 |
| B. 保留现状 resolver，仅去单例化 | 否决 | 只解决卫生问题，不解决模型形态（公理 4）；渲染隔离仍不覆盖目录重载/展开/输入场景 |
| C. 组装期 join + 字段等值 memo（**定案，已实现**） | 采纳 | 状态成为视图节点一等属性；join 是纯函数（既有纯函数全复用）；比较器使隔离场景从 1 种扩展到 6 种；fileStore 零改动、跨 feature 零改动 |

## 1. 数据模型

### 视图节点类型（src/shared/types/file.ts）

```ts
export type FileTreeGitStatus = 'conflict' | 'deleted' | 'modified' | 'renamed' | 'untracked' | 'added';

export type FileTreeViewNode = FileNode & {
  // git 状态投影
  git_status?: FileTreeGitStatus;
  is_ignored?: boolean;
  // 逐节点视图状态投影（实现修正：全部视图状态入模，见 §10-1）
  is_active?: boolean;        // activeFilePath 命中
  is_selected?: boolean;      // selectedPath 命中
  is_expanded?: boolean;      // 目录已展开
  dir_state?: DirLoadState;   // 目录加载状态（仅目录）
  creating_input?: { kind: 'file' | 'dir'; value: string };  // 内联新建命中（仅目录）
  renaming_name?: string;     // 内联重命名命中
};
```

**FileNode 本体不动**：目录桶是 fs 事实模型（fs 事件写入），git 状态与视图状态是
投影层（快照/面板状态派生），生命周期与写入方不同。WSL/Remote 命令序列化路径不受影响。

## 2. Join 层：组装期一次盖章

### buildFileTreeView 扩展（src/shared/utils/fileTree.ts）

```ts
export interface FileTreeViewInput {
  activeFilePath?: string | null;
  selectedPath?: string | null;
  dirLoadStates?: Record<string, DirLoadState>;
  creating?: { dirPath: string; kind: 'file' | 'dir' } | null;
  creatingValue?: string;
  renaming?: { path: string; isDir: boolean; name: string } | null;
}

export function buildFileTreeView(
  dirs: Record<string, FileNode[]>,
  expandedDirs: Set<string>,
  input: FileTreeViewInput = {},
  decorate?: (path: string, isDir: boolean) => NodeGitStatusInput | null,
): FileTreeViewNode[]
```

- git 语义状态经 `decorate` 盖章；逐节点视图状态经 `input` 盖章——**全部状态
  在组装 walk 时写入节点字段**，字段只在命中/非默认时存在（节点形状最小）
- 每个产出节点写入**子树指纹**（自身全部语义字段 + 全部后代指纹的 Merkle 组合），
  存模块私有 `WeakMap` + `viewNodeFingerprint` 访问器——不污染节点形状 / toEqual /
  序列化。这是 memo 正确性的承重结构：后代任何变化都会逐层反映到祖先指纹，
  祖先重渲染把新节点对象送达子节点

### resolveNodeStatus 提取（src/shared/utils/gitFileDecoration.ts）

从 `resolveDecoration` 提取语义核心，两者共享：

- 文件取自身摘要 / 目录取 folderSummaries 聚合（含折叠目录自身 key；deleted 已在
  构建期剥离；未展开深层祖先基于 changed 全集携带摘要）
- 折叠 untracked 目录后代经 `findInheritedCollapsedDir` 二分前缀继承
- ignored 沿祖先链上行（`isPathIgnored`），`ignored` 返回**原始事实**，
  状态共存时由呈现层让状态优先
- `resolveDecoration`（PR 树消费）重构为其上的 Decoration 形状投影，行为零变化
  （既有测试全部保持绿为硬门，已验证）
- 新增 `statusToNameColorClass(status, ignored, isActive)`：叶子级名字色，
  优先级链（active > conflict > deleted > modified > renamed > untracked > added >
  ignored 灰显 > 默认）单处收敛（词表封闭约定不变）

### FilesPanel

- 四个派生 useMemo（fileSummaries / collapsedDirs / folderSummaries / ignoredSet）
  保留；`decorate` = useCallback 包 `resolveNodeStatus`
- viewTree useMemo 依赖：`[dirs, expandedDirs, activeFilePath, loadStates,
  state.selectedNode, state.creating, state.creatingValue, state.renaming, decorate]`
- 删除 publish/resolve 用法与 `resolveNodeDecoration`

## 3. 呈现层：叶子内聚

FileTreeNode（`FileTreeNodeInner` + memo 化 `FileTreeNodeMemo` 导出）：

- 只收「节点 + 稳定回调」：node / depth / projectId + 10 个回调——**无任何会逐节点
  变化的动态 props**（激活/选中/展开/加载/内联编辑全部读节点字段）
- 名字色 = `statusToNameColorClass(node.git_status, node.is_ignored === true, isActive)`
- 重命名命中（`node.renaming_name`）行替换为 InlineNameInput；新建输入
  （`node.creating_input`，含击键值）渲染在命中目录的子列表首位

## 4. 渲染隔离：子树指纹比较器（承重墙）

`fileTreeNodeProps.ts`：props 契约 + `areFileTreeNodePropsEqual` 同文件
（比较器必须逐字段枚举 props，与接口放在一起才能在新增 prop 时被同一次修改覆盖）。

```ts
export function areFileTreeNodePropsEqual(prev, next): boolean {
  if (a.path !== b.path) return false;
  if (viewNodeFingerprint(a) !== viewNodeFingerprint(b)) return false;  // 子树语义
  if (prev.depth !== next.depth) return false;
  if (prev.projectId !== next.projectId) return false;
  for (const key of HANDLER_KEYS) if (prev[key] !== next[key]) return false;
  return true;
}
```

- **HANDLER_KEYS 排除 `onCreatingSubmit` / `onRenamingSubmit`**：二者闭包引用击键
  状态、身份每次击键变化；它们只被「输入行所在节点」消费，而该节点的
  creating_input / renaming_name 随击键变化 → 指纹变化 → 必然重渲染拿到新闭包，
  陈旧闭包不可达
- 其余回调身份恒定：`handleToggleDir` 经 `expandedDirsRef` 镜像读取展开态
  （useFilePanelState 实现修正，见 §10-2），deps 不再含 expandedDirs

效果矩阵（渲染计数测试逐一断言）：

| 场景 | 现状 | 本方案 |
|---|---|---|
| git 快照变化（状态未变路径） | 0 重渲染 | 0 重渲染 |
| git 快照变化（状态变化路径） | 仅变化节点 | 仅变化链路（节点 + 祖先行） |
| 目录桶重载（内容未变） | **整树** | 0 重渲染 |
| 桶内容变化 | **整树** | 仅受影响链路 |
| 展开/收起 | **整树** | 该节点 + 新挂载子树 |
| tab 切换 | **整树** | 新旧激活链路（节点 + 祖先行） |
| 新建输入每击键 | **整树** | 输入行所在链路 |

（实现修正：任何「送达子节点新 props」的机制都要求祖先链重渲染——父节点 bail out
后子元素永不更新。因此状态变化/tab 切换的重渲染集 = 变化节点 + 其祖先行，
不是单节点；祖先行渲染极廉价，语义上仍是 O(变更)。）

## 5. 语义 parity 清单（全部保持，测试验证）

deleted 不向目录传播 / 目录聚合基于 changed 全集 / 折叠 untracked 后代继承 /
折叠目录自身携带状态 / 状态与 ignored 共存状态优先 / 激活 accent 最高优先 /
renamed 徽标保真（PR 树）/ G1 契约（后端，未触碰）。

## 6. 删除清单 / 保留清单

**已删除**：`getSharedDecorationResolver` / `SharedDecorationResolver` /
`createDecorationResolver` / `DecorationResolver` / decorationsEqual；FilesPanel 的
publish/resolve 用法；FileTreeNode 的 `decoration` / `resolveDecorationFor` props；
resolver 相关测试用例。

**保留（PR ChangeFileTree 继续消费，行为零变化）**：`resolveDecoration` /
`summaryToBadge` / `summaryToDotClass` / `buildFileSummaryMap` /
`buildFolderSummaryMap` / `collectCollapsedDirs` / `Decoration` /
`GitStatusSummary` / `summaryToLabelClass` / `STATUS_PRESENTATION`。
`ResolveNodeDecoration` 类型保留（标注过渡期，禁止新消费方）。

## 7. 影响文件清单（实现实际落地）

| 文件 | 变更 |
|---|---|
| src/shared/types/file.ts | +`FileTreeGitStatus` / `FileTreeViewNode`（含全部视图投影字段） |
| src/shared/utils/fileTree.ts | +`FileTreeViewInput` / decorate 参数 / 子树指纹（WeakMap + `viewNodeFingerprint`） |
| src/shared/utils/gitFileDecoration.ts | +`resolveNodeStatus` / `statusToNameColorClass`；resolveDecoration 重构（行为不变）；−resolver 全家 |
| src/features/file/components/fileTreeNodeProps.ts | **新增**：props 契约 + 指纹比较器 |
| src/features/file/components/FileTreeNode.tsx | 节点字段直读；内聚呈现；递归经 memo 化导出（§10-3）；瘦 props |
| src/features/file/components/FilesPanel.tsx | 组装期 join（input + decorate）；删 resolver 用法；瘦 props |
| src/features/file/hooks/useFilePanelState.ts | handleToggleDir 经 expandedDirsRef 稳定身份（§10-2） |
| src/features/file/store.ts | **零改动** |
| src/features/git/hooks/useGitStatusEventsSync.ts | **零改动** |
| src/app/dock/wrappers/FilesPanelWrapper.tsx | **零改动**（changedFiles/ignoredFiles 接线保留） |
| src/features/file/hooks/useFileTreeSync.ts | **零改动**（ignoredFiles 剪枝输入保留） |
| 测试 | fileTree 盖章 6 用例 / 比较器 10 用例 / 渲染计数 7 场景（3 既有 + 4 新增）/ gitFileDecoration +12 用例 |

## 8. 测试计划（已全部落地）

1. 纯函数：组装盖章（git 投影 + 视图状态 + 无 decorate 兼容）
2. parity：resolveNodeStatus 与 resolveDecoration 同输入逐路径对照
3. 渲染计数 7 场景（harness 复用真实比较器 + 异步 mock 工厂动态 import 真实依赖，
   规避 import/order 重排的初始化顺序风险）
4. 比较器纯函数单测：指纹等值 / 各投影字段 / 排除回调的语义
5. 既有测试保持绿：FilesPanel 全套（真实组件颜色语义）、gitFileDecoration 全套、
   realPayload、useFileTreeSync 等

## 9. Non-Goals 与后续衔接

S2（排除式监听）、S4（虚拟化）、`ignored_files` 数组退役（需后端 gitignore 感知
readDirTree）、fsmonitor / untracked cache 引导——均独立立项。
本方案的视图节点字段化为 S4 窗口化铺路（窗口行 = FileTreeViewNode）。

## 10. 实现期修正记录（设计误判与发现）

1. **逐节点视图状态必须入模，不能走 props**：最初设计只把 git 状态入模，
   activeFilePath / expandedDirs / dirLoadStates / creating / renaming 仍走 props +
   「逐节点投影比较」。实现验证时发现结构性漏洞：**子元素 props 在父渲染时创建，
   父节点 bail out 后子元素永不更新**——props 流经渲染树投递，投影比较对
   「流经父节点的动态 props」天然失效（tab 切换用例失败暴露）。修正：全部视图
   状态在组装期盖章为节点字段，由指纹统一承载；FileTreeNode 退化为
   「节点 + 稳定回调」。
2. **handleToggleDir 身份抖动**：原实现闭包引用 expandedDirs（deps 含之），每次
   展开/收起换身份 → 整树重渲染。修正：`expandedDirsRef` 镜像 + 函数式 setState，
   回调身份恒定（点击发生在 commit 后，ref 读取语义与闭包一致）。
3. **递归绕过 memo 的存量缺陷（本次修复）**：原 FileTreeNode 递归引用函数声明
   本身（`<FileTreeNode/>`），**深度节点从未被 memo 保护**——P3 的隔离仅对
   FilesPanel 直渲染的根级子节点生效，深链全靠「父不重渲染」间接成立。修正为
   递归引用 memo 化导出（`FileTreeNodeMemo`），指纹比较器在每一层生效。
   harness 同步修正（mock 工厂内递归引用 memo 化常量）。
