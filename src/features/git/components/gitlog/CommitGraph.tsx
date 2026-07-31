import React, { useMemo } from 'react';

import type { CommitEntry } from '@/features/git/types';

/**
 * ROW_HEIGHT 必须与 CommitList.tsx 中保持一致。
 * dot 视觉中心 Y = i * ROW_HEIGHT + ROW_HEIGHT / 2
 */
export const ROW_HEIGHT = 32;
export { BRANCH_SPACING, NODE_RADIUS, LINE_W, laneColor };

// ── 布局常量 ───────────────────────────────────────────────────────────────
const BRANCH_SPACING = 6; // 每列水平宽度
const NODE_RADIUS = 4; // commit dot 半径
const LINE_W = 1.5; // 线宽

const LANE_COLORS = [
  'var(--accent-blue)',
  'var(--accent-green)',
  'var(--accent-yellow)',
  'var(--accent-red)',
];

function laneColor(branchOrder: number): string {
  return LANE_COLORS[branchOrder % LANE_COLORS.length];
}

// ── 类型 ───────────────────────────────────────────────────────────────────
interface CommitGraphProps {
  commits: CommitEntry[];
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  hoveredHash?: string | null;
  /** Row index after which an inline expand is open (-1 = none). */
  expandAfterRow?: number;
  /** Pixel height of the inline expand panel to offset subsequent rows. */
  expandOffsetY?: number;
}

/** 一段直线分支路径，列内从 start 行画到 end 行 */
export interface BranchSegment {
  col: number;
  /** 起始行（含） */
  start: number;
  /** 结束行（含），Infinity 表示延伸到末尾 */
  end: number;
  branchOrder: number;
}

/** 已计算位置的 commit 节点 */
export interface CommitNode {
  hash: string;
  parents: string[];
  children: string[];
  /** 列号 */
  x: number;
  /** 行号（拓扑序索引，0 = 最新） */
  y: number;
  /** 颜色（由 branchOrder 决定） */
  color: string;
}

// ── 核心算法：按 DoltHub computePosition.ts 实现 ───────────────────────────

/**
 * 构建 childrenMap：parent hash → [child hash...]
 */
function buildChildrenMap(commits: CommitEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const commit of commits) {
    for (const parentHash of commit.parents) {
      const list = map.get(parentHash) ?? [];
      list.push(commit.hash);
      map.set(parentHash, list);
    }
  }
  return map;
}

/**
 * 计算所有 commit 的 (x, y) 位置以及分支直线段。
 *
 * 算法来源：https://www.dolthub.com/blog/2024-08-07-drawing-a-commit-graph/
 *
 * commits[0] = 最新（顶部），按拓扑序排列。
 * y = 行索引（0-based），x = 列索引（0-based）。
 *
 * 三类 commit 的列分配：
 *   1. 无 children（HEAD commit）→ 新建一列
 *   2. 有 branch children（parents[0] === commit 的 child）→ 放到最左侧 branch child 所在列
 *   3. 只有 merge children → 从 maxChildX+1 开始找空位列
 */
export function computeLayout(commits: CommitEntry[]): {
  nodes: CommitNode[];
  segments: BranchSegment[];
  totalCols: number;
  maxColUsed: number;
  truncatedRows: number[];
} {
  if (commits.length === 0)
    return { nodes: [], segments: [], totalCols: 0, maxColUsed: 0, truncatedRows: [] };

  const childrenMap = buildChildrenMap(commits);

  // 按输入顺序（已是拓扑序）构建 CommitNode，初始 x=-1, y=index
  const commitsMap = new Map<string, CommitNode>();
  commits.forEach((c, i) => {
    commitsMap.set(c.hash, {
      hash: c.hash,
      parents: c.parents,
      children: childrenMap.get(c.hash) ?? [],
      x: -1,
      y: i,
      color: '',
    });
  });

  // columns[col] = BranchSegment[]，记录每列上的分支段
  const columns: BranchSegment[][] = [];
  const commitCols = new Map<string, number>(); // hash → col
  let branchOrder = 0;

  function updateSegmentEnd(col: number, end: number) {
    const segs = columns[col];
    if (segs && segs.length > 0) {
      segs[segs.length - 1].end = end;
    }
  }

  const truncatedRows: number[] = [];

  commits.forEach((commit, index) => {
    const node = commitsMap.get(commit.hash)!;
    // parent 在视图内：segment 延伸到 parent 行（由算法收尾）
    // parent 不在视图内（分页截断）或无 parent（root）：segment 终止在本行
    const hasVisibleParent = node.parents.some((p) => commitsMap.has(p));
    const isRoot = node.parents.length === 0;
    const end = isRoot || !hasVisibleParent ? index : Infinity;
    if (!isRoot && !hasVisibleParent) {
      truncatedRows.push(index);
    }

    // branch children：parents[0] === commit.hash 的 child
    const branchChildren = node.children.filter((childHash) => {
      const child = commitsMap.get(childHash);
      return child && child.parents[0] === commit.hash;
    });

    const isHead = node.children.length === 0;
    const hasBranchChildren = branchChildren.length > 0;

    let commitX: number;

    if (isHead) {
      // 类型 1：HEAD commit → 新建列
      commitX = columns.length;
      columns.push([{ col: commitX, start: index, end, branchOrder }]);
      branchOrder++;
    } else if (hasBranchChildren) {
      // 类型 2：有 branch children → 最左侧 branch child 所在列
      const branchChildCols = branchChildren
        .map((h) => commitCols.get(h))
        .filter((c): c is number => c !== undefined);

      commitX = Math.min(...branchChildCols);

      // 延伸本列的 segment 到当前行
      updateSegmentEnd(commitX, end);

      // 其他 branch child 列：它们的 segment 在当前行-1 结束（它们在此处分叉）
      branchChildCols
        .filter((cx) => cx !== commitX)
        .forEach((cx) => updateSegmentEnd(cx, index - 1));
    } else {
      // 类型 3：只有 merge children → 找空位列
      let minChildY = Infinity;
      let maxChildX = -1;

      node.children.forEach((childHash) => {
        const child = commitsMap.get(childHash)!;
        if (child.y < minChildY) minChildY = child.y;
        const cx = commitCols.get(childHash) ?? -1;
        if (cx > maxChildX) maxChildX = cx;
      });

      // 从 maxChildX+1 开始找"最后一个 segment 已结束"的列
      const startSearch = maxChildX + 1;
      const slotIdx = columns.slice(startSearch).findIndex((segs) => {
        const last = segs[segs.length - 1];
        return minChildY >= last.end;
      });

      if (slotIdx === -1) {
        // 没有可用列，新建
        commitX = columns.length;
        columns.push([{ col: commitX, start: minChildY + 1, end, branchOrder }]);
        branchOrder++;
      } else {
        commitX = startSearch + slotIdx;
        columns[commitX].push({
          col: commitX,
          start: minChildY + 1,
          end,
          branchOrder,
        });
        branchOrder++;
      }
    }

    commitCols.set(commit.hash, commitX);
    node.x = commitX;
  });

  // 给每个 node 分配颜色（根据其所在列的 branchOrder）
  for (const node of commitsMap.values()) {
    const segs = columns[node.x];
    if (segs) {
      // 找包含当前行的 segment
      const seg = segs.find((s) => s.start <= node.y && node.y <= s.end);
      node.color = laneColor(seg ? seg.branchOrder : 0);
    } else {
      node.color = laneColor(0);
    }
  }

  // 展平所有 segments（用于画直线）
  const segments: BranchSegment[] = columns.flat();
  const totalCols = columns.length || 1;

  // 找到实际使用的最大列号（节点或 segment）
  let maxColUsed = 0;
  for (const node of commitsMap.values()) {
    if (node.x > maxColUsed) maxColUsed = node.x;
  }
  for (const seg of segments) {
    if (seg.col > maxColUsed) maxColUsed = seg.col;
  }

  return {
    nodes: Array.from(commitsMap.values()),
    segments,
    totalCols,
    maxColUsed,
    truncatedRows,
  };
}

// ── 坐标转换 ───────────────────────────────────────────────────────────────

/**
 * commit 节点在 SVG 里的像素坐标。
 * 当行内 expand 打开时，expand 行之后的节点整体下移 expandOffsetY，
 * 与 DOM 列表被撑开后的位置对齐。
 */
function nodeXY(
  col: number,
  row: number,
  expandAfterRow = -1,
  expandOffsetY = 0,
): [number, number] {
  const extraY = expandAfterRow >= 0 && row > expandAfterRow ? expandOffsetY : 0;
  return [col * BRANCH_SPACING + NODE_RADIUS * 2, row * ROW_HEIGHT + ROW_HEIGHT / 2 + extraY];
}

/** 行中心 Y（用于线段端点），含 expand 偏移 */
function rowCenterY(row: number, expandAfterRow = -1, expandOffsetY = 0): number {
  const extraY = expandAfterRow >= 0 && row > expandAfterRow ? expandOffsetY : 0;
  return row * ROW_HEIGHT + ROW_HEIGHT / 2 + extraY;
}

// ── 曲线路径（DoltHub curvePath 公式） ────────────────────────────────────

function curvePath(start: [number, number], end: [number, number]): string {
  const cx1 = start[0] * 0.1 + end[0] * 0.9;
  const cy1 = start[1] * 0.6 + end[1] * 0.4;
  const cx2 = start[0] * 0.03 + end[0] * 0.97;
  const cy2 = start[1] * 0.4 + end[1] * 0.6;
  return `M ${start[0]} ${start[1]} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end[0]} ${end[1]}`;
}

/** 与 curvePath 相同的三次贝塞尔控制点（P1、P2）。 */
function curveControlPoints(
  start: [number, number],
  end: [number, number],
): [[number, number], [number, number]] {
  const cx1 = start[0] * 0.1 + end[0] * 0.9;
  const cy1 = start[1] * 0.6 + end[1] * 0.4;
  const cx2 = start[0] * 0.03 + end[0] * 0.97;
  const cy2 = start[1] * 0.4 + end[1] * 0.6;
  return [
    [cx1, cy1],
    [cx2, cy2],
  ];
}

/** 三次贝塞尔在 t 处的点。 */
function bezierPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
    mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/**
 * 二分法求三次贝塞尔曲线在 targetY 处的 X。
 *
 * 前提：控制点 Y 都在端点 Y 之间（curveControlPoints 公式保证），
 * 因此 B(t).y 单调，二分法收敛可靠。
 */
export function bezierXAtY(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  targetY: number,
): number {
  const minY = Math.min(p0[1], p3[1]);
  const maxY = Math.max(p0[1], p3[1]);
  if (targetY <= minY) return p0[1] < p3[1] ? p0[0] : p3[0];
  if (targetY >= maxY) return p0[1] < p3[1] ? p3[0] : p0[0];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bezierPoint(p0, p1, p2, p3, mid)[1] < targetY) lo = mid;
    else hi = mid;
  }
  return bezierPoint(p0, p1, p2, p3, (lo + hi) / 2)[0];
}

/**
 * 计算每行的最大 graph X（竖线 + 曲线在该行 Y 处的实际路径）。
 *
 * textLeft(row) = rowMaxX[row] + TEXT_AFTER_DOT_GAP，保证文字始终位于
 * 该行所有 graph 元素（含交叉曲线）的右侧，不被遮挡。
 * 与 CommitGraph 渲染共用同一套几何（nodeXY / curveControlPoints）。
 */
export function computeRowMaxX(commits: CommitEntry[]): number[] {
  if (commits.length === 0) return [];
  const { nodes, segments } = computeLayout(commits);
  const n = commits.length;
  const rowMaxX = new Array<number>(n).fill(0);

  // 1. 竖线 segment 覆盖的行
  for (const seg of segments) {
    const endRow = seg.end === Infinity ? n - 1 : seg.end;
    const x = seg.col * BRANCH_SPACING + NODE_RADIUS * 2;
    for (let r = seg.start; r <= endRow; r++) {
      if (x > rowMaxX[r]) rowMaxX[r] = x;
    }
  }

  // 2. 曲线采样：merge（第二+ parent）与 branch-out 曲线
  const nodesMap = new Map<string, CommitNode>();
  for (const node of nodes) nodesMap.set(node.hash, node);

  const sampleCurve = (p0: [number, number], p3: [number, number]) => {
    const [p1, p2] = curveControlPoints(p0, p3);
    const minY = Math.min(p0[1], p3[1]);
    const maxY = Math.max(p0[1], p3[1]);
    const maxX = Math.max(p0[0], p1[0], p2[0], p3[0]);
    const firstRow = Math.max(0, Math.floor(minY / ROW_HEIGHT));
    const lastRow = Math.min(n - 1, Math.ceil(maxY / ROW_HEIGHT));
    for (let r = firstRow; r <= lastRow; r++) {
      if (rowMaxX[r] >= maxX) continue; // 该行已比曲线最右点更靠右，跳过
      const x = bezierXAtY(p0, p1, p2, p3, r * ROW_HEIGHT + ROW_HEIGHT / 2);
      if (x > rowMaxX[r]) rowMaxX[r] = x;
    }
  };

  for (const node of nodes) {
    const start = nodeXY(node.x, node.y);
    // merge 曲线：node → parents[1..N]
    for (let p = 1; p < node.parents.length; p++) {
      const parent = nodesMap.get(node.parents[p]);
      if (!parent) continue;
      sampleCurve(start, nodeXY(parent.x, parent.y));
    }
    // branch-out 曲线：node → branch children（跨列）
    for (const childHash of node.children) {
      const child = nodesMap.get(childHash);
      if (!child) continue;
      if (child.parents[0] === node.hash && child.x !== node.x) {
        sampleCurve(start, nodeXY(child.x, child.y));
      }
    }
  }

  return rowMaxX;
}

// ── React 组件 ─────────────────────────────────────────────────────────────

const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  selectedHash,
  hoveredHash,
  expandAfterRow = -1,
  expandOffsetY = 0,
}) => {
  const { nodes, segments, maxColUsed, truncatedRows } = useMemo(
    () => computeLayout(commits),
    [commits],
  );

  // nodesMap for quick lookup
  const nodesMap = useMemo(() => {
    const m = new Map<string, CommitNode>();
    for (const n of nodes) m.set(n.hash, n);
    return m;
  }, [nodes]);

  if (commits.length === 0) return null;

  const offset = expandAfterRow >= 0 ? expandOffsetY : 0;

  // 动态宽度：只到实际最右列的右边缘 + 少量 padding
  const svgWidth = (maxColUsed + 1) * BRANCH_SPACING + NODE_RADIUS * 4;
  // 高度包含行内 expand 占位，避免后续节点被裁切
  const svgHeight = commits.length * ROW_HEIGHT + offset;

  const xy = (col: number, row: number): [number, number] =>
    nodeXY(col, row, expandAfterRow, offset);

  return (
    <div className="shrink-0" style={{ width: svgWidth, minWidth: svgWidth }}>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block', overflow: 'visible' }}>
        {/* ── 直线段（每条分支在其列内的竖线） ── */}
        {segments.map((seg, si) => {
          const endRow = seg.end === Infinity ? commits.length - 1 : seg.end;
          // start === end 表示单行孤立段，画 1px 竖线保持视觉延续
          if (seg.start === endRow) {
            const x = seg.col * BRANCH_SPACING + NODE_RADIUS * 2;
            const y = rowCenterY(seg.start, expandAfterRow, offset);
            return (
              <line
                key={`seg-${si}`}
                x1={x}
                y1={y}
                x2={x}
                y2={y + 1}
                stroke={laneColor(seg.branchOrder)}
                strokeWidth={LINE_W}
              />
            );
          }
          const x = seg.col * BRANCH_SPACING + NODE_RADIUS * 2;
          const y1 = rowCenterY(seg.start, expandAfterRow, offset);
          const y2 = rowCenterY(endRow, expandAfterRow, offset);
          // 若线段跨越 expand 行，在中间插入竖直间隙对应的折线（用两段 line）
          const color = laneColor(seg.branchOrder);
          const crossesExpand =
            offset > 0 &&
            expandAfterRow >= 0 &&
            seg.start <= expandAfterRow &&
            endRow > expandAfterRow;

          if (crossesExpand) {
            const yAtExpand = rowCenterY(expandAfterRow, expandAfterRow, 0);
            const yAfterExpand = rowCenterY(expandAfterRow + 1, expandAfterRow, offset);
            return (
              <g key={`seg-${si}`}>
                <line x1={x} y1={y1} x2={x} y2={yAtExpand} stroke={color} strokeWidth={LINE_W} />
                {/* bridge across expand panel */}
                <line
                  x1={x}
                  y1={yAtExpand}
                  x2={x}
                  y2={yAfterExpand}
                  stroke={color}
                  strokeWidth={LINE_W}
                  strokeOpacity={0.35}
                />
                <line x1={x} y1={yAfterExpand} x2={x} y2={y2} stroke={color} strokeWidth={LINE_W} />
              </g>
            );
          }

          return (
            <line
              key={`seg-${si}`}
              x1={x}
              y1={y1}
              x2={x}
              y2={y2}
              stroke={color}
              strokeWidth={LINE_W}
            />
          );
        })}

        {/* ── 曲线（branch-out 和 merge） ── */}
        {nodes.map((node) => {
          const curves: React.ReactNode[] = [];

          // 1. Merge 曲线：从本 commit 到第二+ parent（合并线，向下弯）
          for (let p = 1; p < node.parents.length; p++) {
            const parent = nodesMap.get(node.parents[p]);
            if (!parent) continue;
            const start = xy(node.x, node.y);
            const end = xy(parent.x, parent.y);
            curves.push(
              <path
                key={`merge-${node.hash}-${p}`}
                d={curvePath(start, end)}
                stroke={parent.color}
                strokeWidth={LINE_W}
                fill="none"
              />,
            );
          }

          // 2. Branch-out 曲线：从本 commit 到 branch children（分叉线，向上弯）
          node.children.forEach((childHash) => {
            const child = nodesMap.get(childHash);
            if (!child) return;
            if (child.parents[0] === node.hash && child.x !== node.x) {
              const start = xy(node.x, node.y);
              const end = xy(child.x, child.y);
              curves.push(
                <path
                  key={`branch-${node.hash}-${childHash}`}
                  d={curvePath(start, end)}
                  stroke={child.color}
                  strokeWidth={LINE_W}
                  fill="none"
                />,
              );
            }
          });

          return curves;
        })}

        {/* ── Commit dot（画在最上层，遮住线端） ── */}
        {nodes.map((node) => {
          const [cx, cy] = xy(node.x, node.y);
          const isHovered = node.hash === hoveredHash;
          const isSelected = node.hash === selectedHash;
          // Soft ring instead of scale — keeps graph/text hover visually aligned
          // over the full-row background highlight.
          const showRing = isHovered || isSelected;
          const ringRadius = NODE_RADIUS + (isSelected ? 2.5 : 2);
          return (
            <g key={`dot-${node.hash}`}>
              {showRing ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={ringRadius}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={isSelected ? 1.5 : 1}
                  strokeOpacity={isSelected ? 0.9 : 0.55}
                />
              ) : null}
              <circle cx={cx} cy={cy} r={NODE_RADIUS} fill={node.color} />
            </g>
          );
        })}

        {/* Truncation markers for paged mode */}
        {truncatedRows.map((row) => {
          const node = nodes[row];
          if (!node) return null;
          const [cx, cy] = xy(node.x, row);
          const y1 = cy + NODE_RADIUS;
          const y2 = y1 + 8;
          return (
            <g key={`trunc-${row}`}>
              <line
                x1={cx}
                y1={y1}
                x2={cx}
                y2={y2}
                stroke={node.color}
                strokeWidth={LINE_W}
                strokeDasharray="3,2"
                strokeOpacity={0.5}
              />
              <polygon
                points={`${cx - 3},${y2} ${cx + 3},${y2} ${cx},${y2 + 4}`}
                fill={node.color}
                fillOpacity={0.5}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default React.memo(CommitGraph);
