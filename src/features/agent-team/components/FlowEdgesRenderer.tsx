import React from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { flowLayout, type FlowEdge } from '../utils/flowLayout';
import { memberTint, type MemberTintTone } from '../utils/memberTint';

/** 成员身份色 → SVG stroke class（与头像同一 tint 调色板：边的颜色即所有权）。 */
const TINT_STROKE: Record<MemberTintTone, string> = {
  blue: 'stroke-accent-blue',
  green: 'stroke-accent-green',
  orange: 'stroke-accent-orange',
  brick: 'stroke-accent-brick',
  yellow: 'stroke-accent-yellow',
};

/** lead 节点与首层任务之间的层间距（create 边要跨过它）。 */
export const LEAD_GAP = 34;

interface FlowEdgesProps {
  layout: ReturnType<typeof flowLayout>;
  taskById: Map<string, TaskCard>;
  memberById: Map<string, MemberStatusView>;
  centerX: (index: number, count: number) => number;
  layerY: (layer: number) => number;
  memberX: (index: number) => number;
  memberY: number;
  nodeH: number;
}

/**
 * flow 图的**边渲染**（S 曲线 + 身份色）：拐点在两行之间的中点，任何布局下都从
 * 节点边缘出发、落在节点边缘，不会斜穿别的节点。认领边按成员身份色着色
 * （与花名册头像同一 tint 调色板）—— 边的颜色即所有权，不需要追着线看它连到谁。
 */
export function renderFlowEdges({
  layout,
  taskById,
  memberById,
  centerX,
  layerY,
  memberX,
  memberY,
  nodeH,
}: FlowEdgesProps): React.ReactNode[] {
  /** lead 节点底的起点（lead 盒固定画在任务层上方，见 `TeamFlowGraph`）。 */
  const leadBottomY = layerY(0) - LEAD_GAP;
  const leadX = centerX(0, 1);

  return layout.edges.map((edge: FlowEdge) => {
    if (edge.kind === 'create') {
      const taskLayer = layout.layers.findIndex((layer) => layer.includes(edge.to));
      if (taskLayer < 0) return null;
      const idx = layout.layers[taskLayer].indexOf(edge.to);
      const tx = centerX(idx, layout.layers[taskLayer].length);
      const ty = layerY(taskLayer);
      const mid = (leadBottomY + ty) / 2;
      return (
        <path
          key={`create-${edge.to}`}
          // lead → 任务：**这是「一个需求拆成哪些任务」的那条线**。
          d={`M ${leadX} ${leadBottomY} C ${leadX} ${mid}, ${tx} ${mid}, ${tx} ${ty}`}
          // 派发边：比依赖边实、比认领边淡 —— 「谁派的」与「谁在干」分得开。
          className="flow-create stroke-border-strong"
          strokeWidth={1.2}
          strokeDasharray="1 3"
          fill="none"
          markerEnd="url(#flow-arr)"
        />
      );
    }
    if (edge.kind === 'dep') {
      const from = taskById.get(edge.from);
      const to = taskById.get(edge.to);
      if (!from || !to) return null;
      const fromLayer = layout.layers.findIndex((layer) => layer.includes(edge.from));
      const toLayer = layout.layers.findIndex((layer) => layer.includes(edge.to));
      if (fromLayer < 0 || toLayer < 0) return null;
      const x1 = centerX(
        layout.layers[fromLayer].indexOf(edge.from),
        layout.layers[fromLayer].length,
      );
      const y1 = layerY(fromLayer) + nodeH;
      const x2 = centerX(layout.layers[toLayer].indexOf(edge.to), layout.layers[toLayer].length);
      const y2 = layerY(toLayer);
      const mid = (y1 + y2) / 2;
      return (
        <path
          key={`dep-${edge.from}-${edge.to}`}
          d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
          strokeDasharray="4 3"
          className="stroke-text-muted"
          strokeWidth={1.2}
          fill="none"
          markerEnd="url(#flow-arr)"
        />
      );
    }
    const memberIndex = layout.memberRow.indexOf(edge.from);
    const task = taskById.get(edge.to);
    const taskLayer = layout.layers.findIndex((layer) => layer.includes(edge.to));
    if (memberIndex < 0 || !task || taskLayer < 0) return null;
    const taskIndex = layout.layers[taskLayer].indexOf(edge.to);
    const mx = memberX(memberIndex);
    const my = memberY - 14;
    const tx = centerX(taskIndex, layout.layers[taskLayer].length);
    const ty = layerY(taskLayer) + nodeH;
    const mid = (my + ty) / 2;
    const owner = memberById.get(edge.from);
    const tone: MemberTintTone = owner ? memberTint(owner.agentId) : 'blue';
    return (
      <path
        key={`claim-${edge.from}-${edge.to}`}
        d={`M ${mx} ${my} C ${mx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`}
        className={cn('flow-claim', TINT_STROKE[tone])}
        strokeWidth={1.6}
        fill="none"
      />
    );
  });
}
