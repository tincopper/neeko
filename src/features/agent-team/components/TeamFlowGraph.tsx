import React, { useMemo } from 'react';

import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { useFlowViewport } from '../hooks/useFlowViewport';
import { flowLayout } from '../utils/flowLayout';
import { TEXT_TITLE_STYLE } from '../utils/svgText';

import { renderFlowEdges } from './FlowEdgesRenderer';
import FlowTaskNode, { NODE_H, NODE_W } from './FlowTaskNode';

/**
 * 分配 flow 图 —— 队长怎么拆活、派给谁，一张图看清（原型视图 ⑥ 的落地形态）。
 *
 * # 它是什么、不是什么
 *
 * 图是**快照的投影**：任务按 `dependsOn` 拓扑分层（[`flowLayout`]），节点副标题用两行
 * 分别写「谁该做」（`assignee`）与「谁在做」（`owner`），互不覆盖。它不编排任何东西 ——
 * 编排决策仍只由队长 agent 做；也不新增 IPC（字段全来自既有快照，红线 4 天然安全）。
 * 「成员 → 任务」实线已取消：它与副标题是同一事实的第二份投影，会漂移（改派后线指向 A
 * 而卡片写 B）。依赖虚线保留 —— 它编码**顺序**；派发实线只连首层，否则曲线穿过中间层。
 *
 * # 布局与成员行
 *
 * dock 右栏很窄（~300px），故**层**改成上下分段：依赖在上、被依赖在下。宽度按层内最多
 * 节点数撑开，`viewBox` 等比缩放到容器宽。第 2 轮裁决「成员行先不要了」：`flowLayout`
 * 的 `workerRow` / `memberRow` 纯计算**保留**（恢复只需加回一块 JSX），这里不消费；
 * `members` prop 仍在（aria-label 要报成员数），几何只按任务层 + lead 胶囊算。
 *
 * # 视口：wheel zoom + pointer pan（第 2 轮）
 *
 * `zoom` 有值 = 受控（中央 tab 的按钮与 wheel 都回写 `onZoomChange`）；省略 = 组件自管
 * 一份 `innerZoom`（dock）。**绝不两边各存一份再同步**（红线 17 同族）。wheel 必须原生
 * 非 passive 注册：React 合成 `onWheel` 是 passive，`preventDefault()` 会被忽略、页面跟着滚。
 * 钳制 / wheel 方向 / 拖动阈值都在 [`flowViewport`] 纯函数里；画布 pan 不是列表排序，
 * 不用 dnd-kit。详情是**既有能力**（`TeamTaskCenterView`），图上不复制一份；宿主未注入
 * `onOpenTask` 时节点不宣称可点（没有 role / 光标 / aria-label）。
 */
interface TeamFlowGraphProps {
  tasks: readonly TaskCard[];
  members: readonly MemberStatusView[];
  /**
   * 打开任务详情（`teamId` 在前：任务 id 只在队内唯一）。
   *
   * `undefined` = 宿主未注入跨域导航（如测试 / 中央 tab 未接线）。此时节点**不挂**
   * `role="button"` / `tabIndex` / `cursor-pointer`、也不写「打开详情」的 aria-label ——
   * 承诺一个不存在的动作比没有按钮更糟。
   */
  onOpenTask?: (teamId: string, taskId: string, title: string) => void;
  /**
   * 缩放倍率（有值 = 受控，中央 tab 的 +/- 按钮）。受控时 SVG 用精确像素
   * `contentW × zoom`；省略 = dock 响应式，滚轮缩放由组件内部 state 承接。
   */
  zoom?: number;
  /** 受控时 wheel / 缩放的回写口； dock 不传 —— 同一时刻只有一个 zoom 持有者。 */
  onZoomChange?: (zoom: number) => void;
}

/** 层间距（viewBox 单位）。第 2 轮节点加高到 52，34 会比节点行距还挤，故 34 → 40。 */
const GAP_X = 10;
const GAP_Y = 40;

/** 响应式模式的 svg 样式（未缩放时撑满容器）。 */
const SVG_FILL_STYLE = { width: '100%', minWidth: 260 } as const;
/** 滚动容器要有界，垂直 pan 才有可滚动的空间（无界时 scrollTop 永远为 0）。 */
const VIEWPORT_STYLE = { maxHeight: '70vh' } as const;

const TeamFlowGraph: React.FC<TeamFlowGraphProps> = React.memo(
  ({ tasks, members, onOpenTask, zoom, onZoomChange }) => {
    const layout = useMemo(() => flowLayout(tasks, members), [tasks, members]);
    const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

    const {
      viewportRef,
      effectiveZoom,
      precise,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onClickCapture,
    } = useFlowViewport({ zoom, onZoomChange });

    const taskNode = (id: string) => {
      const task = taskById.get(id);
      return task ?? null;
    };

    // 内容宽 = 任务层宽 / lead 胶囊宽的最大值；成员行已不渲染，故不再计入。
    const widestLayer = Math.max(1, ...layout.layers.map((layer) => layer.length), 1);
    const layerW = widestLayer * NODE_W + (widestLayer + 1) * GAP_X;
    const contentW = Math.max(layerW, 160);
    const leadY = 8;
    const tasksTop = leadY + 30 + GAP_Y;
    const contentH = tasksTop + layout.layers.length * (NODE_H + GAP_Y);

    /** 节点中心 x（层内居中整行）。 */
    const centerX = (indexInLayer: number, count: number) => {
      const rowW = count * NODE_W + (count - 1) * GAP_X;
      return (contentW - rowW) / 2 + indexInLayer * (NODE_W + GAP_X) + NODE_W / 2;
    };

    const layerY = (layer: number) => tasksTop + layer * (NODE_H + GAP_Y);

    return (
      <section aria-label="任务分配图" className="flex flex-col gap-2 p-2">
        <header className="flex flex-wrap items-center justify-between gap-1 px-1">
          <h3 className="text-meta font-semibold text-text-secondary">任务分配图</h3>
        </header>
        <div
          ref={viewportRef}
          data-testid="flow-viewport"
          className="overflow-auto rounded-md border border-border bg-bg-primary p-1"
          style={VIEWPORT_STYLE}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
        >
          <svg
            viewBox={`0 0 ${contentW} ${contentH}`}
            width={precise ? Math.round(contentW * effectiveZoom) : undefined}
            height={precise ? Math.round(contentH * effectiveZoom) : undefined}
            style={precise ? undefined : SVG_FILL_STYLE}
            role="img"
            aria-label={`任务分配图：${tasks.length} 个任务，${members.length} 个成员`}
          >
            <defs>
              <marker
                id="flow-arr"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)" />
              </marker>
            </defs>
            {/* 队长（创建者）：只有首层任务从它出发 */}
            {layout.layers.length > 0 ? (
              <g>
                <rect
                  x={contentW / 2 - 46}
                  y={leadY}
                  width={92}
                  height={24}
                  rx={6}
                  className="fill-bg-tertiary stroke-text-muted"
                  strokeWidth={1}
                />
                <text
                  x={contentW / 2}
                  y={leadY + 16}
                  textAnchor="middle"
                  className="fill-text-secondary"
                  style={TEXT_TITLE_STYLE}
                >
                  队长 · 派活
                </text>
              </g>
            ) : null}
            {/* 边：派发实线（首层） + 依赖虚线；成员→任务的实线已取消 */}
            {renderFlowEdges({
              layout,
              taskById,
              centerX,
              layerY,
              nodeH: NODE_H,
            })}
            {/* 任务节点：按层摆放；注入 onOpenTask 时才可点（否则不宣称可点） */}
            {layout.layers.flatMap((layer, layerIndex) =>
              layer.map((id, index) => {
                const task = taskNode(id);
                if (!task) return null;
                return (
                  <FlowTaskNode
                    key={id}
                    task={task}
                    cx={centerX(index, layer.length)}
                    y={layerY(layerIndex)}
                    onOpenTask={onOpenTask}
                  />
                );
              }),
            )}
          </svg>
        </div>
        {tasks.length === 0 ? (
          <p className="px-1 text-micro text-text-muted">
            还没有任务 —— 队长派活后这里会长出依赖图。
          </p>
        ) : null}
      </section>
    );
  },
);
TeamFlowGraph.displayName = 'TeamFlowGraph';

export default TeamFlowGraph;
