import React from 'react';

import type { TaskCard } from '@/shared/types/team';

import { flowLayout } from '../utils/flowLayout';

/** lead 节点与首层任务之间的层间距（create 边要跨过它）。派发只连首层，不再有跨层曲线。 */
export const LEAD_GAP = 34;

interface FlowEdgesProps {
  layout: ReturnType<typeof flowLayout>;
  taskById: Map<string, TaskCard>;
  centerX: (index: number, count: number) => number;
  layerY: (layer: number) => number;
  nodeH: number;
}

/**
 * flow 图的**边渲染**（S 曲线）：拐点在两行之间的中点，任何布局下都从节点边缘出发、
 * 落在节点边缘，不会斜穿别的节点。
 *
 * # 只有两种边：派发（create）与依赖（dep）
 *
 * 成员**不再**通过一条实线连到任务：谁该做由任务行上的 `assignee`（计划事实）/
 * `owner`（执行事实）直接表达，节点副标题已经写着它。再画一条成员→任务的实线
 * 就是同一份信息的第二个投影 —— 两者不一致时（队长改派过、或任务被回收）
 * 用户会看到线指向 A 而卡片写着 B。
 *
 * `kind` 的联合类型只有两值：删掉一种边之后，任何残留的 `claim` 分支都会变成
 * **编译错误**（而不是永远不触发的死代码）。
 */
export function renderFlowEdges({
  layout,
  taskById,
  centerX,
  layerY,
  nodeH,
}: FlowEdgesProps): React.ReactNode[] {
  /** lead 节点底的起点（lead 盒固定画在任务层上方，见 `TeamFlowGraph`）。 */
  const leadBottomY = layerY(0) - LEAD_GAP;
  const leadX = centerX(0, 1);

  return layout.edges.map((edge) => {
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
          // lead → 首层任务：**这是「一个需求拆成哪些入口任务」的那条线**。
          d={`M ${leadX} ${leadBottomY} C ${leadX} ${mid}, ${tx} ${mid}, ${tx} ${ty}`}
          // 第 2 轮 `1 3` 点线 + 极淡描边在浅底上几乎全是空隙，只剩一个孤零零的箭头。
          // 改成可见**实线**：与依赖边靠线型（实线 vs `4 3` 虚线）区分，不靠颜色深浅。
          className="flow-create stroke-text-muted"
          strokeWidth={1.4}
          fill="none"
          markerEnd="url(#flow-arr)"
        />
      );
    }
    // 剩下的只有 `dep`：`kind` 的联合类型只有两值，所以这里不写
    // `if (edge.kind === 'dep')` —— 那个分支恒真，读起来像还有第三种边。
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
  });
}
