import type { DockSlot, TabKindLike, ViewKey } from './types';

/**
 * ViewKey 的**唯一**铸造点（与 `WorkspaceSession.of(...).key` 同构：身份字符串只允许
 * 经一个函数产出，消费侧不手拼）。
 *
 * 持久化快照里的字符串**不需要解析**：真伪由 `DOCK_VIEW_META` 查表裁定
 * （不在表里 → 丢弃）。因此这里刻意不提供 `parseViewKey` —— 那会成为第二份前缀知识。
 */

/** 单例工具面板（如 files / gitControl）。 */
export const panelView = (panelId: string): ViewKey => `panel:${panelId}` as ViewKey;

/** 槽位 tab 宿主（P1）。 */
export const tabHostView = (slot: DockSlot): ViewKey => `tabHost:${slot}` as ViewKey;

/** 种类级入口（P2）。 */
export const tabKindView = (kind: TabKindLike): ViewKey => `tabKind:${kind}` as ViewKey;

/** 中心视图入口（如 library）。 */
export const appViewKey = (view: string): ViewKey => `appView:${view}` as ViewKey;

/**
 * 语法侧最小校验（非空字符串）：只用于把外部来源（dnd 的 `UniqueIdentifier`）收窄成
 * ViewKey。**刻意不校验前缀** —— 前缀语义属于声明表，在这里再写一遍就是第二份真源。
 */
export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === 'string' && value.trim() !== '';
}
