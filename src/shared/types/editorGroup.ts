// ─── Editor Group Types ─────────────────────────────────────────────────────
import type { DockSlot } from '@/shared/dock/types';

export type EditorGroupId = 'left' | 'right';

export interface EditorGroupState {
  tabIds: string[];
  activeTabId: string | null;
}

/**
 * 编辑器 pane 的身份（中心三组 + 两个槽位 tab 宿主）。
 *
 * **归属的唯一表示**是 `EditorSplitLayout` 里的组本身（组即顺序与归属，见 I1）；
 * 本类型只是「渲染哪个组」的寻址词，**不是**给 `Tab` 增加 surface 字段的第二份表示。
 */
export type EditorPaneId = EditorGroupId | 'pinned' | 'dockLeft' | 'dockRight';

/** Dock 槽位 → 宿主 pane 身份（唯一映射；宿主不得由当前 activeView 反推自己是谁）。 */
export const DOCK_PANE_ID: Record<DockSlot, 'dockLeft' | 'dockRight'> = {
  left: 'dockLeft',
  right: 'dockRight',
};

export interface EditorSplitLayout {
  isSplit: boolean;
  ratio: number;
  activeGroupId: EditorGroupId;
  groups: {
    left: EditorGroupState;
    right: EditorGroupState;
  };
  /**
   * 槽位 tab 宿主的分组（与 `groups` 同构：组即顺序与归属）。
   *
   * 一条 tab 在任一时刻只属于其中一个组（G1 单值 surface）—— 双归属会让
   * `TerminalView` / agent stream 双挂载（双 PTY），所以移动是单次原子 mutator
   * （`editorStore.dockTab`：先全域移除再插入目标组）。
   */
  docked: Record<DockSlot, EditorGroupState>;
  /** 已 pin 的 tab 列表（有序，多个）。 */
  pinnedTabIds: string[];
  /** pinned 面板当前激活的 tab id。 */
  pinnedActiveTabId: string | null;
  pinnedPanelRatio: number;
}

export function emptyEditorGroup(): EditorGroupState {
  return { tabIds: [], activeTabId: null };
}

export function createDefaultEditorLayout(): EditorSplitLayout {
  return {
    isSplit: false,
    ratio: 0.5,
    activeGroupId: 'left',
    groups: {
      left: emptyEditorGroup(),
      right: emptyEditorGroup(),
    },
    docked: {
      left: emptyEditorGroup(),
      right: emptyEditorGroup(),
    },
    pinnedTabIds: [],
    pinnedActiveTabId: null,
    pinnedPanelRatio: 0.35,
  };
}

/** 中心组归属（drag / 分屏语义只看中心组；dock 宿主不在其中）。 */
export function findGroupIdForTab(layout: EditorSplitLayout, tabId: string): EditorGroupId | null {
  if (layout.groups.left.tabIds.includes(tabId)) return 'left';
  if (layout.groups.right.tabIds.includes(tabId)) return 'right';
  return null;
}

/**
 * 新建 tab / Action Menu 的落组目标。
 *
 * dock 宿主不是落组（它不是「中心分屏」的一侧）：`null` = 由调用方退回 `addTab` 的
 * 缺省落组（当前中心组）。`chrome: 'dock'` 下这些入口不渲染，此返回只是让类型不必说谎。
 */
export function centerDropTargetOf(paneId: EditorPaneId): EditorGroupId | 'pinned' | null {
  return paneId === 'dockLeft' || paneId === 'dockRight' ? null : paneId;
}

export function oppositeGroup(groupId: EditorGroupId): EditorGroupId {
  return groupId === 'left' ? 'right' : 'left';
}
