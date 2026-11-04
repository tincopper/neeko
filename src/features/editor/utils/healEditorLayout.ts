import type { EditorGroupState, EditorSplitLayout, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

/**
 * 布局自愈：把 store 里的布局修成「当前 tab 注册表的合法投影」。
 *
 * 为什么需要：布局可能引用已移除的 tab（session restore、分屏来回搬、关闭路径的边角），
 * 而 `EditorGroupPane` 的 `activeTab` 查找按 id 命中 —— 一旦激活位指向幽灵 id，内容区
 * 就渲染空白而 tab 条还在（历史缺陷「blank content area」）。
 *
 * 纯函数、不写回 store：heal 只在读取侧生效，写入仍由各 mutator 负责（否则渲染期产生写入）。
 */
export function healEditorLayout(rawLayout: EditorSplitLayout, allTabs: Tab[]): EditorSplitLayout {
  const liveTabIdSet = new Set(allTabs.map((tab) => tab.id));
  const heal = (group: EditorGroupState): string | null => {
    const liveTabIds = group.tabIds.filter((id) => liveTabIdSet.has(id));
    if (group.activeTabId && liveTabIds.includes(group.activeTabId)) return group.activeTabId;
    if (liveTabIds.length === 0) return null;
    // 布局即唯一权威：本组激活位失效时取最后一个存活 tab（不再参考空间级投影）。
    return liveTabIds[liveTabIds.length - 1];
  };

  const leftActive = heal(rawLayout.groups.left);
  const rightActive = heal(rawLayout.groups.right);
  const dockedLeftActive = heal(rawLayout.docked.left);
  const dockedRightActive = heal(rawLayout.docked.right);
  const livePinnedIds = rawLayout.pinnedTabIds.filter((id) => liveTabIdSet.has(id));
  const pinnedActive =
    rawLayout.pinnedActiveTabId && livePinnedIds.includes(rawLayout.pinnedActiveTabId)
      ? rawLayout.pinnedActiveTabId
      : livePinnedIds.length > 0
        ? livePinnedIds[livePinnedIds.length - 1]
        : null;

  const unchanged =
    rawLayout.groups.left.activeTabId === leftActive &&
    rawLayout.groups.right.activeTabId === rightActive &&
    rawLayout.pinnedActiveTabId === pinnedActive &&
    rawLayout.docked.left.activeTabId === dockedLeftActive &&
    rawLayout.docked.right.activeTabId === dockedRightActive;
  if (unchanged) return rawLayout;

  return {
    ...rawLayout,
    groups: {
      left: { ...rawLayout.groups.left, activeTabId: leftActive },
      right: { ...rawLayout.groups.right, activeTabId: rightActive },
    },
    docked: {
      left: { ...rawLayout.docked.left, activeTabId: dockedLeftActive },
      right: { ...rawLayout.docked.right, activeTabId: dockedRightActive },
    },
    pinnedActiveTabId: pinnedActive,
  };
}

/**
 * 布局缺失时的兜底（不变量 I1 成立后不可达）：把所有 tab 放进 left 组、激活最后一个。
 * 与 heal 同属「读取侧派生」——把 store 缺失形状翻译成可渲染布局。
 */
export function fallbackEditorLayout(allTabs: Tab[]): EditorSplitLayout {
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = allTabs.map((tab) => tab.id);
  layout.groups.left.activeTabId = allTabs.length > 0 ? allTabs[allTabs.length - 1].id : null;
  return layout;
}
