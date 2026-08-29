import React, { Suspense } from 'react';

import { fixedPanelRegistry, type PanelPlacement } from './registry';

interface PanelHostProps {
  placement: PanelPlacement;
}

/**
 * 按 placement 渲染固定面板宿主。
 *
 * 目前所有固定面板均为 bottom（布局底部）；placement 字段为将来 dock 统一
 * 面板体系（面板跨区移动、单一 registry）预留归位语义。Suspense fallback 为
 * null —— 面板隐藏态本就不占位，lazy 加载瞬间无闪烁。
 */
function PanelHost({ placement }: PanelHostProps) {
  const panels = fixedPanelRegistry.filter((p) => p.placement === placement);
  if (panels.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {panels.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </Suspense>
  );
}

export default React.memo(PanelHost);
