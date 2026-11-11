import React, { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView, TaskCard, TeamTaskState } from '@/shared/types/team';

import { flowLayout } from '../utils/flowLayout';

import { renderFlowEdges } from './FlowEdgesRenderer';

/**
 * 分配 flow 图 —— 队长怎么拆活、派给谁，一张图看清（原型视图 ⑥ 的落地形态）。
 *
 * # 它是什么、不是什么
 *
 * 图是**快照的投影**：任务按 `dependsOn` 拓扑分层（[`flowLayout`]），认领边把任务连到
 * 它的持有者。它不编排任何东西 —— 编排决策仍只由队长 agent 做；它也不新增 IPC（全部
 * 字段来自既有快照，红线 4 天然安全）。与「声明式 DAG 编排器」（已迁出到 work-items
 * 的 `flow`）的边界必须守住。
 *
 * # 布局为什么是纵向分层
 *
 * dock 右栏很窄（~300px）：横向五列的看板已经撑过一次（见 [`TeamTaskBoard`] 的文档），
 * 图更宽，所以**层**从并排改成上下分段 —— 依赖在上、被依赖在下、成员在底行，因果
 * 自上而下。宽度按层内最多节点数撑开，SVG `viewBox` 等比缩放到容器宽。
 *
 * # 点击任务 = 打开任务详情的中央 tab
 *
 * 详情是**既有能力**（`TeamTaskCenterView`，点开才拉正文）：图上不复制一份详情面板 ——
 * 第二份详情就是第二份「点开才拉」的纪律要照顾的地方。宿主未注入 `onOpenTask` 时
 * 节点不宣称可点（没有 role / 光标 / aria-label）。
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
   * 缩放倍率（中央 tab 的缩放控制用）。有值 = SVG 按精确像素渲染（`contentW × zoom`），
   * **等比**缩放整个 viewBox —— 节点、文字、边一起变大变小，父容器 `overflow-auto`
   * 负责滚动。省略 = 响应式（宽度撑满容器，dock 300px 列的现状）。
   */
  zoom?: number;
}

/** 节点尺寸与间距（viewBox 单位；渲染时等比缩放）。 */
const NODE_W = 132;
const NODE_H = 38;
const GAP_X = 10;
const GAP_Y = 34;

/**
 * SVG 文字样式（模块级常量）。
 *
 * 不写成 JSX 内联字面量：① 每次渲染都会新建对象，SVG 每帧都对 `style` 做 diff；
 * ② 同一组字号重复 5 处，改一处漏四处。字号是 viewBox 单位，随 `zoom` 一起缩放。
 */
const TEXT_TITLE_STYLE = { fontSize: 10, fontWeight: 600 } as const;
const TEXT_META_STYLE = { fontSize: 9 } as const;
const TEXT_SUB_STYLE = { fontSize: 8 } as const;
/** 响应式模式的 svg 样式（zoom 省略时撑满容器）。 */
const SVG_FILL_STYLE = { width: '100%', minWidth: 260 } as const;
/** 节点标题 / 成员名的截断长度（超出加省略号，避免溢出节点框）。 */
const TASK_TITLE_MAX_CHARS = 12;
const MEMBER_NAME_MAX_CHARS = 14;

/** 超长文本截断并加省略号；短于上限时原样返回。 */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** 状态 → 节点描边色（语义与任务板的列一致；封闭映射，新状态编不过）。 */
const STATE_STROKE: Record<TeamTaskState, string> = {
  pending: 'stroke-border',
  claimed: 'stroke-accent-blue',
  in_progress: 'stroke-accent-blue',
  awaiting_approval: 'stroke-accent-yellow',
  done: 'stroke-accent-green',
  failed: 'stroke-accent-red',
  blocked: 'stroke-accent-red',
  proposed: 'stroke-accent-blue',
};

const TeamFlowGraph: React.FC<TeamFlowGraphProps> = React.memo(
  ({ tasks, members, onOpenTask, zoom }) => {
    const layout = useMemo(() => flowLayout(tasks, members), [tasks, members]);
    const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
    const memberById = useMemo(
      () => new Map(members.map((member) => [member.memberId, member])),
      [members],
    );

    const taskNode = (id: string) => {
      const task = taskById.get(id);
      return task ?? null;
    };

    // 内容宽 = 任务层 / 成员行 / lead 胶囊三者的最大值。**漏掉成员行**会让成员多、
    // 任务少时节点溢出 viewBox 右缘（症状：成员 chip 被裁掉一半，看不全）。
    const widestLayer = Math.max(1, ...layout.layers.map((layer) => layer.length), 1);
    const layerW = widestLayer * NODE_W + (widestLayer + 1) * GAP_X;
    const memberW =
      Math.max(layout.memberRow.length, 1) * NODE_W +
      (Math.max(layout.memberRow.length, 1) + 1) * GAP_X;
    const contentW = Math.max(layerW, memberW, 160);
    const leadY = 8;
    const tasksTop = leadY + 30 + GAP_Y;
    const contentH =
      tasksTop + layout.layers.length * (NODE_H + GAP_Y) + (layout.memberRow.length > 0 ? 40 : 0);

    /** 节点中心 x（层内居中整行）。 */
    const centerX = (indexInLayer: number, count: number) => {
      const rowW = count * NODE_W + (count - 1) * GAP_X;
      return (contentW - rowW) / 2 + indexInLayer * (NODE_W + GAP_X) + NODE_W / 2;
    };

    const layerY = (layer: number) => tasksTop + layer * (NODE_H + GAP_Y);
    const memberY = contentH - 40;
    const memberX = (index: number) => {
      const count = Math.max(layout.memberRow.length, 1);
      const rowW = count * NODE_W + (count - 1) * GAP_X;
      return (contentW - rowW) / 2 + index * (NODE_W + GAP_X) + NODE_W / 2;
    };

    return (
      <section aria-label="任务分配图" className="flex flex-col gap-2 p-2">
        <header className="flex flex-wrap items-center justify-between gap-1 px-1">
          <h3 className="text-meta font-semibold text-text-secondary">任务分配图</h3>
          <span className="text-micro text-text-muted">虚线 = 依赖 · 实线 = 认领</span>
        </header>
        <div className="overflow-x-auto rounded-md border border-border bg-bg-primary p-1">
          <svg
            viewBox={`0 0 ${contentW} ${contentH}`}
            width={zoom !== undefined ? Math.round(contentW * zoom) : undefined}
            height={zoom !== undefined ? Math.round(contentH * zoom) : undefined}
            style={zoom !== undefined ? undefined : SVG_FILL_STYLE}
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
            {/* 队长（创建者）：只有一层，所有第 0 层任务都从它出发 */}
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
            {/* 边：S 曲线 + 身份色（渲染器见 [`renderFlowEdges`]） */}
            {renderFlowEdges({
              layout,
              taskById,
              memberById,
              centerX,
              layerY,
              memberX,
              memberY,
              nodeH: NODE_H,
            })}
            {/* 任务节点：按层摆放；注入 onOpenTask 时才可点（否则不宣称可点） */}
            {layout.layers.flatMap((layer, layerIndex) =>
              layer.map((id, index) => {
                const task = taskNode(id);
                if (!task) return null;
                const interactive =
                  onOpenTask === undefined
                    ? {}
                    : {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `打开任务 ${task.id} 的详情：${task.title}`,
                        onClick: () => onOpenTask(task.teamId, task.id, task.title),
                        onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenTask(task.teamId, task.id, task.title);
                          }
                        },
                        className: 'cursor-pointer',
                      };
                return (
                  <g key={id} {...interactive}>
                    <rect
                      x={centerX(index, layer.length) - NODE_W / 2}
                      y={layerY(layerIndex)}
                      width={NODE_W}
                      height={NODE_H}
                      rx={7}
                      className={cn('fill-bg-secondary', STATE_STROKE[task.state])}
                      strokeWidth={1.2}
                    />
                    <text
                      x={centerX(index, layer.length)}
                      y={layerY(layerIndex) + 16}
                      textAnchor="middle"
                      className="fill-text-primary"
                      style={TEXT_TITLE_STYLE}
                    >
                      {truncate(task.title, TASK_TITLE_MAX_CHARS)}
                    </text>
                    <text
                      x={centerX(index, layer.length)}
                      y={layerY(layerIndex) + 29}
                      textAnchor="middle"
                      className="fill-text-muted"
                      style={TEXT_META_STYLE}
                    >
                      {`${task.id} · ${task.owner === null ? '待认领' : (task.owner.split('@')[0] ?? '')}`}
                    </text>
                  </g>
                );
              }),
            )}
            {/* 成员行 */}
            {layout.memberRow.map((memberId, index) => {
              const member = memberById.get(memberId);
              const worker = layout.workerRow[index];
              return (
                <g key={memberId}>
                  <rect
                    x={memberX(index) - NODE_W / 2}
                    y={memberY - 16}
                    width={NODE_W}
                    height={32}
                    rx={6}
                    className="fill-bg-tertiary stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={memberX(index)}
                    y={memberY - 2}
                    textAnchor="middle"
                    className="fill-text-secondary"
                    style={TEXT_TITLE_STYLE}
                  >
                    {truncate(member?.name ?? memberId, MEMBER_NAME_MAX_CHARS)}
                  </text>
                  {/* 角色 + 任务数：这张图要能回答「分工是否合理、谁没被用上」。 */}
                  <text
                    x={memberX(index)}
                    y={memberY + 10}
                    textAnchor="middle"
                    className="fill-text-muted"
                    style={TEXT_SUB_STYLE}
                  >
                    {`${worker?.persona ?? '未设角色'} · ${worker?.taskCount ?? 0} 任务`}
                  </text>
                </g>
              );
            })}
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
