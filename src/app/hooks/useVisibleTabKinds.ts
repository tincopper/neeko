import { useCallback, useMemo } from 'react';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';

import { selectVisibleTabKinds } from '../utils/tabKind';

/**
 * 「此刻屏幕上能看到哪些 tab 种类」的响应式形态（图标选中态）。
 *
 * 判据本体在 `utils/tabKind.selectVisibleTabKinds`（纯函数，可穷举）；本 hook 只负责
 * **订阅正确的切片**：
 * - 键都用 `?? undefined` / 引用型切片，selector 不得返回新对象或新数组 —— 那会让
 *   zustand 每次都判不等（无限重渲染）；
 * - 返回的函数按 `useMemo` 出的集合判断，集合不变则引用不变（`React.memo` 的按钮
 *   不会因为无关的重渲染而刷新）。
 */
export function useVisibleTabKinds(): (kind: string) => boolean {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const tabKey = useActiveWorkspaceKey(activeProjectId);
  const tabs = useEditorStore((s) => (tabKey ? s.tabs[tabKey] : undefined));
  const layout = useEditorStore((s) => (tabKey ? s.editorLayout[tabKey] : undefined));
  const zones = useDockStore((s) => s.zones);
  const appView = useAppViewStore((s) => s.appView);

  const visible = useMemo(
    () => selectVisibleTabKinds(tabs, layout, { zones }, appView),
    [appView, layout, tabs, zones],
  );

  return useCallback((kind: string) => visible.has(kind), [visible]);
}
