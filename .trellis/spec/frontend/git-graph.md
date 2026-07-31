# Git History Graph 渲染规范

> Git commit history DAG 渲染的不变量、布局算法与渲染契约。

---

## 概述

`src/features/git/components/gitlog/` 下的 commit history graph 是一个 DAG（有向无环图）可视化组件。核心挑战：**在分页加载和虚拟滚动下保持线条连续性和列稳定性**。

核心文件：

| 文件 | 职责 |
|------|------|
| `CommitGraph.tsx` | SVG 渲染（节点、线段、曲线） |
| `useCommitLayout.ts` | 布局状态管理（useMemo 缓存） |
| `useGitLog.ts` | 数据加载（分页 overlap） |
| `CommitList.tsx` | DOM 列表 + 虚拟化 |
| `virtualScroll.ts` | 虚拟滚动计算 |

---

## 核心不变量（Invariants）

### 列恒等性（Column Identity）

**规则**：同一个 commit hash 在所有渲染中必须保持相同的列号（x）。

**原因**：如果列号变化，滚动时线条会水平跳动，破坏视觉连续性。

**实现**：`useCommitLayout` 使用 `useMemo`，只在 `commits` 数组身份变化时重新计算。由于 `useGitLog` 分页 overlap 保证 parent 已在视图内，新 page 的列分配只追加，不修改已有节点。

### 边端点精确性（Edge Endpoint Precision）

**规则**：所有曲线端点必须精确落在目标节点的中心坐标。

**公式**：
```
nodeCenter(hash) = (col * BRANCH_SPACING + NODE_RADIUS * 2, row * ROW_HEIGHT + ROW_HEIGHT / 2)
```

**禁止**：
- ❌ `endRow = node.y + 1` （估算）
- ✅ `endRow = parent.y` （实际坐标）

### 分支连续性（Branch Continuity）

**规则**：同一列内的分支线必须是连续的竖直线，覆盖该列从最顶端 commit 到底部 commit 的全部行。

**原因**：git graph 的视觉约定是"一条竖线 = 一个分支生命周期"。

**实现**：segment 合并——同一列的多个 segment 在渲染时视觉上相连，不应出现断裂。

### 分页连续性（Pagination Continuity）

**规则**：加载更多数据时，新 page 的第一个 commit 的 parent 必须在视图内。

**实现**：`useGitLog.loadMore` 使用 `skip = commits.length - 1`（overlap 1 条）。

---

## 算法：computeLayout

### 输入
- `commits: CommitEntry[]` — 按拓扑序排列（commits[0] = HEAD，最新）

### 输出
- `nodes: CommitNode[]` — 每个 commit 的 (x, y, color)
- `segments: BranchSegment[]` — 每列的竖直线段
- `totalCols: number` — 总列数
- `maxColUsed: number` — 实际使用的最大列号
- `truncatedRows: number[]` — 分页截断行标记

### 列分配规则

1. **HEAD（无 children）** → 新建一列
2. **有 branch children（child.parents[0] === commit.hash）** → 继承最左侧 branch child 的列
3. **只有 merge children** → 从 `maxChildX + 1` 开始找"最后一个 segment 已结束"的列；若无，新建

### 颜色分配

按 `branchOrder % LANE_COLORS.length` 循环。同一分支的所有 commit 共享同一 branchOrder。

---

## 渲染契约

### SVG 尺寸

```
width  = (maxColUsed + 1) * BRANCH_SPACING + NODE_RADIUS * 4
height = commits.length * ROW_HEIGHT + expandOffsetY
```

### 元素层次

1. **直线段**（`<line>`）— 列内竖线
2. **曲线**（`<path>`）— branch-out / merge 曲线
3. **节点**（`<circle>`）— commit 圆点，画在最上层遮住线端
4. **截断标记**（`<polygon>`）— 分页边界指示

### 曲线路径

贝塞尔曲线公式（来自 DoltHub）：

```
cx1 = start[0] * 0.1 + end[0] * 0.9
cy1 = start[1] * 0.6 + end[1] * 0.4
cx2 = start[0] * 0.03 + end[0] * 0.97
cy2 = start[1] * 0.4 + end[1] * 0.6
```

---

## 性能约束

| 指标 | 要求 |
|------|------|
| 布局计算 | O(n)，n = commits.length |
| 重渲染触发 | 仅 commits/selectedHash/hoveredHash/expand 变化 |
| 虚拟滚动 | 只渲染 viewport + overscan 内的行 |
| 内存 | nodesMap 和 segments 用 useMemo 缓存 |

---

## 常见陷阱

### 1. 估算端点

```typescript
// ❌ 错误：估算 endRow
const endRow = node.y + 1 > parent.y ? parent.y : node.y + 1;
const end = xy(parent.x, endRow);

// ✅ 正确：使用实际节点坐标
const end = xy(parent.x, parent.y);
```

### 2. 分页无 overlap

```typescript
// ❌ 错误：parent 丢失
fetchCommits(commits.length, true, PAGE_SIZE);

// ✅ 正确：overlap 1 条
const skip = commits.length > 0 ? commits.length - 1 : 0;
fetchCommits(skip, true, PAGE_SIZE);
```

### 3. 每帧重算布局

```typescript
// ❌ 错误：每次渲染都重算
const layout = computeLayout(commits);

// ✅ 正确：useMemo 缓存
const layout = useMemo(() => computeLayout(commits), [commits]);
```

### 4. segment start === end 时跳过

```typescript
// ❌ 错误：孤立节点无线
if (seg.start === endRow) return null;

// ✅ 正确：单行 segment 画 1px 竖线保持视觉延续
if (seg.start === endRow) {
  return <line x1={x} y1={y1} x2={x} y2={y1 + 1} stroke={color} strokeWidth={LINE_W} />;
}
```

---

## 测试要求

| 场景 | 测试 |
|------|------|
| 线性历史 | 所有节点在列 0，单条 segment 覆盖全部行 |
| branch + merge | 分支节点在不同列，merge 曲线端点精确连接 |
| 分页截断 | `truncatedRows` 正确标记，segment 不提前关闭 |
| 布局稳定性 | 相同 commits 输入，多次计算输出 identical |

---

## 相关文件

- `src/features/git/components/gitlog/CommitGraph.tsx` — 布局 + 渲染
- `src/features/git/components/gitlog/useCommitLayout.ts` — 持久化布局
- `src/features/git/components/gitlog/useGitLog.ts` — 分页加载
- `src/features/git/components/gitlog/__tests__/commitGraph.test.ts` — 单元测试
- `src/features/git/components/gitlog/virtualScroll.ts` — 虚拟滚动
