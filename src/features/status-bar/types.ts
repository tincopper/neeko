import type { ComponentType } from 'react';

/** StatusBar 簇：左簇为项目状态区，右簇为动作/指示区。 */
export type StatusBarSide = 'left' | 'right';

/**
 * 静态 status-bar item 定义（对齐 dock panelMeta 范本：静态 meta + 确定性排序）。
 * 可见性不进 registry——由组件自守卫 `return null` 表达（hooks 无条件调用）。
 * 互斥（如 lsp 槽位优先级）由 item 内部直写，不设跨组件认领机制。
 */
export interface StatusBarItemDef {
  /** 全局唯一 id；order 冲突时按 id 兜底排序，保证确定性。 */
  id: string;
  side: StatusBarSide;
  /** 稀疏排序（10/20/30…），中间插入无需重排。 */
  order: number;
  /** 无 props 的标准 item 组件（自订阅 store + 自守卫）。 */
  component: ComponentType;
}
