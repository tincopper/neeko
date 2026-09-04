import { NotificationButton } from '@/features/notification';

import { BranchItem } from './items/BranchItem';
import { ConflictsItem } from './items/ConflictsItem';
import { ConsoleItem } from './items/ConsoleItem';
import { CursorItem } from './items/CursorItem';
import { DebugItem } from './items/DebugItem';
import { LspSlotItem } from './items/LspSlotItem';
import { PromptsStatusSection } from './PromptsStatusSection';
import type { StatusBarItemDef, StatusBarSide } from './types';

/**
 * 静态 status-bar registry：左簇（branch、lsp 槽位、conflicts）+ 右簇 5 项。
 * lsp 槽位内部优先级互斥（install > sessions > profile），单组件直写——
 * 仅此一组互斥，不设通用认领机制。新增功能只需加 entry（无需改 StatusBar）。
 */
export const STATUS_BAR_ITEMS: StatusBarItemDef[] = [
  { id: 'branch', side: 'left', order: 10, component: BranchItem },
  { id: 'lsp', side: 'left', order: 20, component: LspSlotItem },
  { id: 'conflicts', side: 'left', order: 50, component: ConflictsItem },
  { id: 'console', side: 'right', order: 10, component: ConsoleItem },
  { id: 'debug', side: 'right', order: 20, component: DebugItem },
  { id: 'cursor', side: 'right', order: 30, component: CursorItem },
  { id: 'prompts', side: 'right', order: 40, component: PromptsStatusSection },
  { id: 'notifications', side: 'right', order: 50, component: NotificationButton },
];

/** 取某簇 items：按 order 排序，order 冲突时按 id 兜底，保证确定性。 */
export function itemsForSide(side: StatusBarSide): StatusBarItemDef[] {
  return STATUS_BAR_ITEMS.filter((d) => d.side === side).sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
  );
}
