import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/** 面板归位语义：目前固定面板均为 bottom；为将来 dock 统一面板体系预留左右。 */
export type PanelPlacement = 'left' | 'right' | 'bottom';

/** 单个固定面板定义：零 props 组件（显示状态由各自 store 驱动）。 */
export interface FixedPanelDef {
  id: string;
  placement: PanelPlacement;
  Component: LazyExoticComponent<ComponentType>;
}

const LazyTaskConsolePanel = lazy(() =>
  import('@/features/task').then((m) => ({ default: m.TaskConsolePanel })),
);

const LazyDebugPanel = lazy(() =>
  import('@/features/debug').then((m) => ({ default: m.DebugPanel })),
);

/**
 * 固定底部面板注册表（单一事实源）。
 *
 * 新增固定面板只改这里 —— 组合根（App.tsx）经 PanelHost 按 placement 渲染，
 * 对面板清单零感知（与 dockPanelRegistry 同一模式，OCP：面板扩展不触碰组合根）。
 * lazy 化：面板代码不进主 chunk，首次渲染按需加载。
 */
export const fixedPanelRegistry: FixedPanelDef[] = [
  { id: 'task-console', placement: 'bottom', Component: LazyTaskConsolePanel },
  { id: 'debug', placement: 'bottom', Component: LazyDebugPanel },
];
