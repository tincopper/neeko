# 重构：将 CommitList 拆分为 Hooks + 展示组件

## 目标

将 `CommitList.tsx` 从 ~600 行降到 180 行以内：副作用逻辑抽成自定义 hooks，行渲染抽成展示组件。

## 背景

`CommitList.tsx` 目前违反项目 React 300 行红线（AGENTS.md 维度 10）。单个组件内混有 5 个 useEffect、7 个 useMemo、约 300 行 JSX，可维护性与可测试性差。

> 注：本 PRD 已对齐工作区现状（commit `c34e16e1` 之后）——文字避让已由 `textLeftByHash` 改为 `computeRowMaxX`/`rowMaxX`（每行取 graph 元素实际最大 X）。本任务不涉及该逻辑本身的改动，只负责搬迁。

## 需求

### R1 — 抽取 `useVirtualScroll` Hook

封装滚动位置跟踪、视口测量、虚拟窗口计算与无限滚动 IntersectionObserver。

**职责：**
- `scrollTop`、`viewportHeight` 状态
- `containerRef` + 滚动事件监听
- 视口高度 `ResizeObserver`
- `rowOffsets` 计算（委托给 `virtualScroll.ts`；**输入由参数注入**，见 Hook 契约）
- 经 `getVirtualWindow` 得到 `startIndex`、`endIndex`、`offsetY`
- `sentinelRef` + `IntersectionObserver` 实现无限滚动
- 暴露 `handleScroll` 回调

### R2 — 抽取 `useExpandPanel` Hook

封装内联展开面板的高度测量。

**职责：**
- `expandHeight` 状态
- `expandRef` 指向展开面板 DOM 元素
- 用 `ResizeObserver` 测量面板高度
- 当 `selectedHash`、`detail`、`files`、`detailLoading`、**或 `detailError`** 变化时重新测量（对齐现码依赖）
- **必须保留的不变量**：展开面板位于虚拟窗口外（`expandRef.current === null`）时，**保留上一次测量高度**，保证 rowOffsets / 总高度在滚动期间稳定；不得清零或重测。该行为需要一条回归测试（见测试策略）。

### R3 — 抽取 `useCommitMenu` Hook

封装右键菜单开/关状态与外部点击关闭。

**职责：**
- `menuOpen` 状态（当前为 `string | null`，记录哪个 commit 的菜单打开）
- `menuRef` 指向菜单容器
- 外部点击关闭菜单的处理器
- 返回 `openMenu`、`closeMenu`、`isMenuOpen` 辅助函数
- **菜单 DOM 归属**：菜单渲染在 `CommitListItem` 内部（row wrapper 内 `absolute` 定位，保持现码行为）；`menuOpen` / `menuRef` 由组合层经 props 下传（ref drilling 属预期）。

### R4 — 创建 `CommitListItem.tsx`

单条 commit 行的展示组件。

**职责：**
- 渲染 commit 消息、refs、时间戳（dot 由 CommitGraph 绘制，item 不画 dot）
- 展开时渲染 `CommitExpandPanel`
- 渲染右键菜单（菜单 DOM 在 item 内）
- 处理行点击（含 `.commit-expand` 点击守卫）、键盘选中、复制 hash、更多按钮
- 全部数据经 props 传入（**不使用任何 hook**，连 hover 都不持有——见下方 hoveredHash 归属）

**hoveredHash 归属（重要）**：`hoveredHash` **必须留在组合层**。CommitGraph overlay（组合层渲染）消费该状态做 dot 高亮；若落进 item 内部，graph 的 `hoveredHash` prop 永远为 null，悬停高亮静默失效。组合层将 `isHovered` 与 `onHoveredChange(hash | null)` 下传给 item。

### R4.5 — 创建 `CommitExpandPanel.tsx`

内联展开详情面板的展示组件（从 item 中拆出，独立文件）。

**职责：**
- 渲染 detail 头部（hash / parents）、body 预览、文件列表（含 `STATUS_ICONS`、增删行数）、操作提示 footer
- 持有 `EXPAND_MAX_HEIGHT`、`STATUS_ICONS` 常量（从现 CommitList 平移）
- `fileStats` 由 `files` 派生（`useMemo` 或纯函数，内部计算）
- loading / error / 无 detail 三种状态
- `expandRef` 由组合层传入（供 useExpandPanel 测量），经此组件挂到面板根节点
- 纯展示：data-in, events-out（`onOpenDiff` / `onPinFile` / `focusedFileIndex`）

**理由**：展开面板约 115 行 JSX + 常量，若并入 item，item 将超 150 行；独立后 item 与面板各自 ≤90 / ≤140 行，且面板 props 与 item 行 props 解耦。

### R5 — 将 `CommitList.tsx` 重构为组合层

**目标：≤ 180 行**

**职责：**
- 调用 `useVirtualScroll`、`useExpandPanel`、`useCommitMenu`、`useCommitLayout`
- **持有 `hoveredHash` 状态**（唯一留在组合层的 UI 状态），同时喂给 `CommitGraph` 与 `CommitListItem`
- 计算 `filteredCommits`、`selectedRowIndex`、`rowMaxX`（`computeRowMaxX`）、graph 宽度、窗口参数
- 渲染带虚拟窗口 transform 的滚动容器
- 渲染 `CommitGraph` SVG overlay（`hoveredHash`、`expandAfterRow`、`expandOffsetY`）
- 为每个可见行渲染 `CommitListItem`
- 渲染空态、加载态、搜索清除按钮、sentinel

## Hook 契约（拆分正确性的唯一耦合点）

> 跨 hook 数据流只有一条链：`expandHeight`（useExpandPanel）→ `rowOffsets`（useVirtualScroll 内部）← `selectedRowIndex`（组合层 memo）。签名如下，实现与测试都以此为准。

```ts
// useVirtualScroll.ts
useVirtualScroll(options: {
  rowCount: number;
  selectedRowIndex: number;   // -1 = 无展开
  expandHeight: number;       // 来自 useExpandPanel
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}): {
  containerRef: RefObject<HTMLDivElement>;
  sentinelRef: RefObject<HTMLDivElement>;
  handleScroll: () => void;
  startIndex: number;
  endIndex: number;
  offsetY: number;
  totalHeight: number;        // rowOffsets 总高度 sentinel（容器高度/哨兵定位）
}

// useExpandPanel.ts
useExpandPanel(options: {
  selectedHash: string | null;
  selectedExpanded: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
}): {
  expandRef: RefObject<HTMLDivElement>;
  expandHeight: number;
}

// useCommitMenu.ts
useCommitMenu(): {
  menuOpen: string | null;
  menuRef: RefObject<HTMLDivElement>;
  openMenu: (hash: string) => void;
  closeMenu: () => void;
  isMenuOpen: (hash: string) => boolean;
}
```

## 验收标准

> 行数目标为实测校准值（实现后实测：CommitList 180 / CommitListItem 199 / CommitExpandPanel 168 / useExpandPanel 54）。行数服务于可读性，禁止为凑行数压缩注释/合并表达式。

- [x] `CommitList.tsx` ≤ 180 行（组合层；loading/空态、graph overlay、map 均在此）
- [x] `useVirtualScroll.ts` ≤ 80 行，签名与契约一致（含 `totalHeight`）
- [x] `useExpandPanel.ts` ≤ 60 行，保留"窗口外不重测"不变量
- [x] `useCommitMenu.ts` ≤ 40 行
- [x] `CommitListItem.tsx` ≤ 210 行，纯展示（无 hook，hover 由 props 驱动）
- [x] `CommitExpandPanel.tsx` ≤ 180 行，纯展示
- [x] `CommitRowMenu.tsx` ≤ 80 行（行菜单独立展示单元）
- [x] `CommitListStates.tsx` ≤ 60 行（loading 骨架 / 空态）
- [x] 全部既有交互保留：滚动、无限加载、展开面板、搜索过滤、右键菜单、行选中、**graph 悬停高亮**
- [x] `pnpm type-check` 通过
- [x] `pnpm exec eslint src/features/git/components/gitlog/` 通过
- [x] `pnpm exec vitest run src/features/git/components/gitlog/` 通过（70 tests）
- [x] commit history 面板无视觉回归（手动：滚动 + 展开 + 悬停 + 搜索）

## 约束

- 不新增 npm 依赖
- `GitLogData` 接口保持不变
- `CommitGraph` 与 `useCommitLayout` 不动（已抽取）
- `virtualScroll.ts` 纯函数保持原样；`useVirtualScroll` 只做包装
- 所有 hooks 必须可用 `renderHook` 独立测试
- 行数目标服务于可读性，禁止为凑行数压缩注释/合并表达式

## 不在范围内

- 修改 `CommitGraph` 或 `useCommitLayout` 的 API
- 修改虚拟滚动数学（`virtualScroll.ts` 纯函数）
- 改变文字避让逻辑（`computeRowMaxX` / `TEXT_AFTER_DOT_GAP`，仅搬迁）
- 新增功能（键盘导航、多选等）
- 优化 `CommitGraph` 渲染性能

## 测试策略

1. **Hook 单元测试**（`renderHook`，文件位于 `__tests__/`）：
   - `useVirtualScroll.test.ts`：窗口计算正确性（注入固定 rowCount/expandHeight）、scroll 更新、RO 测量、IO 触发 onLoadMore、卸载清理
   - `useExpandPanel.test.ts`：初始 0、依赖变化重测、**el 为 null 时保留上次高度（不变量回归）**、卸载清理
   - `useCommitMenu.test.ts`：open/close/isMenuOpen、外部点击关闭、卸载清理
2. **组件集成测试**（`__tests__/CommitList.test.tsx`）：
   - 虚拟窗口内渲染行数正确
   - 行点击展开面板出现；再点收起
   - 搜索过滤减少可见行
   - 悬停行 → CommitGraph 收到 hoveredHash（防悬停高亮回归）
3. **回归**（既有文件，必须保持通过）：
   - `commitGraph.test.ts`（15 tests）
   - `virtualScroll.test.ts`
   - `commitListUtils.test.ts`

## 依赖关系

- 阻塞他人：无
- 被阻塞：无（独立重构）
- 前置：工作区 `CommitList.tsx` 的 `rowMaxX` 改动（c34e16e1 的消费端）需先合入，或与本次拆分同批提交

## 工作量估算

| 分片 | 耗时 |
|-------|--------|
| `useVirtualScroll` | ~1h |
| `useExpandPanel` | ~30min |
| `useCommitMenu` | ~30min |
| `CommitListItem` | ~45min |
| `CommitExpandPanel` | ~45min |
| `CommitList` 组合层 | ~1h |
| 测试 | ~1.5h |
| **合计** | **~5.5h** |
