export type EditorGroupId = "left" | "right";

export interface EditorGroupState {
  tabIds: string[];
  activeTabId: string | null;
}

export interface EditorSplitLayout {
  isSplit: boolean;
  ratio: number;
  activeGroupId: EditorGroupId;
  groups: {
    left: EditorGroupState;
    right: EditorGroupState;
  };
  /** 当前 pin 的 tab ID，null 表示无 pin */
  pinnedTabId: string | null;
  /** pin panel 占总宽度的比例，范围 [0.1, 0.75]，默认 0.35 */
  pinnedPanelRatio: number;
}

export function createDefaultEditorLayout(): EditorSplitLayout {
  return {
    isSplit: false,
    ratio: 0.5,
    activeGroupId: "left",
    groups: {
      left: { tabIds: [], activeTabId: null },
      right: { tabIds: [], activeTabId: null },
    },
    pinnedTabId: null,
    pinnedPanelRatio: 0.35,
  };
}

export function findGroupIdForTab(
  layout: EditorSplitLayout,
  tabId: string
): EditorGroupId | null {
  if (layout.groups.left.tabIds.includes(tabId)) return "left";
  if (layout.groups.right.tabIds.includes(tabId)) return "right";
  return null;
}

export function oppositeGroup(groupId: EditorGroupId): EditorGroupId {
  return groupId === "left" ? "right" : "left";
}
