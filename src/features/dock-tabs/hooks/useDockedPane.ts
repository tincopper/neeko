import { useMemo } from 'react';

import type { DockSlot } from '@/shared/dock';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';

export interface DockedPane {
  tabs: Tab[];
  activeTabId: string | null;
}

/** 稳定空数组：selector 派生值在空态下必须引用同一常量（避免每次渲染都是新数组）。 */
const EMPTY_TABS: Tab[] = [];

/**
 * 槽位宿主的**薄**读取面：只读 `editorLayout[tabKey].docked[slot]` 这一个组。
 *
 * 为什么独立于 `useEditorGroupLayout`（R7）：那个 hook 面向中心布局（分屏 / pinned /
 * 拖拽 / 批量关闭），宿主只需要「这一组有哪些 tab、前台是谁」。共享的是选择器语义
 * （组即顺序与归属），不是那个大对象。`editorStore ⇏ app 层`，本 hook 只读 shared store。
 */
export function useDockedPane(tabKey: string | null, slot: DockSlot): DockedPane {
  const group = useEditorStore((s) => (tabKey ? s.editorLayout[tabKey]?.docked[slot] : undefined));
  const allTabs = useEditorStore((s) => (tabKey ? s.tabs[tabKey]?.tabs : undefined));

  const tabs = useMemo(() => {
    if (!group || !allTabs) return EMPTY_TABS;
    const byId = new Map(allTabs.map((tab) => [tab.id, tab]));
    const ordered: Tab[] = [];
    for (const id of group.tabIds) {
      const tab = byId.get(id);
      if (tab) ordered.push(tab);
    }
    return ordered;
  }, [group, allTabs]);

  // 前台位失效（指向已关闭 / 已移走的 tab）时回落到末位存活 tab —— 与中心 heal 同向，
  // 只为渲染稳定；**归属**仍由布局单独表达（不在这里写回 store）。
  const activeTabId = useMemo(() => {
    if (!group) return null;
    if (group.activeTabId && tabs.some((tab) => tab.id === group.activeTabId)) {
      return group.activeTabId;
    }
    return tabs[tabs.length - 1]?.id ?? null;
  }, [group, tabs]);

  return { tabs, activeTabId };
}
