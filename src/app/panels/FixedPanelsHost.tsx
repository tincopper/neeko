import { Suspense } from 'react';

import { fixedPanelRegistry } from './registry';

/**
 * 固定底部面板宿主：按 fixedPanelRegistry 渲染 AppLayout 下方的固定面板
 * （Task Console / Debug Console）。
 *
 * 面板各自管理显示状态（taskStore / debugStore 驱动），宿主不感知具体面板。
 * Suspense fallback 为 null —— 面板隐藏态本就不占位，lazy 加载瞬间无闪烁。
 */
export default function FixedPanelsHost() {
  return (
    <Suspense fallback={null}>
      {fixedPanelRegistry.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </Suspense>
  );
}
