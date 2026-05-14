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
