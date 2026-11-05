import { useMemo } from 'react';

import type { DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';

import { selectSlotFrontTabKind } from '../utils/tabKind';

/**
 * 某一栏的槽位宿主**此刻前台显示**的 tab 种类（`null` = 这一栏没在显示停靠 tab）。
 *
 * 种类入口图标的选中态：判据本体在 `utils/tabKind.selectSlotFrontTabKind`（纯函数，可穷举），
 * 本 hook 只负责**订阅正确的切片**：
 * - 键都用 `?? undefined` / 引用型切片，selector 不得返回新对象或新数组 —— 那会让
 *   zustand 每次都判不等（无限重渲染）；
 * - 返回值是原始值（`string | null`），所以按钮的 `React.memo` 不会因为无关的重渲染刷新，
 *   也不需要再包一层 `useCallback` 谓词。
 *
 * `slot` 是判据的一部分：图标代表「这一栏的入口」，中心区的前台 tab 与它无关。
 */
export function useSlotFrontTabKind(slot: DockSlot): string | null {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const tabKey = useActiveWorkspaceKey(activeProjectId);
  const tabs = useEditorStore((s) => (tabKey ? s.tabs[tabKey] : undefined));
  const layout = useEditorStore((s) => (tabKey ? s.editorLayout[tabKey] : undefined));
  const zones = useDockStore((s) => s.zones);

  return useMemo(
    () => selectSlotFrontTabKind(tabs, layout, { zones }, slot),
    [layout, slot, tabs, zones],
  );
}
