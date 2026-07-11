import { create } from "zustand";
import type { EditorGroupId, EditorSplitLayout, ProjectTabs, Tab, TabData } from '@/shared/types';
import type { FileTabData, TerminalTabData, DiffTabData, HtmlPreviewTabData, PRDetailTabData } from '@/shared/types/tab';
import type { FileContent } from '@/features/file/types';
import type { DiffSource, ViewMode } from '@/features/git/components/diff/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

function ensureLayout(layouts: Record<string, EditorSplitLayout>, tabKey: string, allTabIds: string[], activeTabId: string | null): EditorSplitLayout {
  if (layouts[tabKey]) return layouts[tabKey];
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = allTabIds;
  layout.groups.left.activeTabId = activeTabId;
  return layout;
}

function mergeTabData(data: TabData, partial: Partial<TabData>): TabData {
  if (partial.kind !== undefined && partial.kind !== data.kind) {
    return data;
  }

  switch (data.kind) {
    case "terminal": {
      const p = partial as Record<string, unknown>;
      const isTerminalPartial =
        "agentId" in p ||
        "status" in p ||
        "taskCommand" in p ||
        "taskConfigId" in p ||
        "rebuildKey" in p;
      if (!isTerminalPartial) return data;
      return {
        kind: "terminal" as const,
        agentId: p.agentId !== undefined ? (p.agentId as string | null) : (data as TerminalTabData).agentId,
        status: p.status !== undefined ? (p.status as "Idle" | "Running" | "Failed") : (data as TerminalTabData).status,
        taskCommand: p.taskCommand !== undefined ? (p.taskCommand as string | undefined) : (data as TerminalTabData).taskCommand,
        taskConfigId: p.taskConfigId !== undefined ? (p.taskConfigId as string | undefined) : (data as TerminalTabData).taskConfigId,
        rebuildKey: p.rebuildKey !== undefined ? (p.rebuildKey as number | undefined) : (data as TerminalTabData).rebuildKey,
      };
    }
    case "file": {
      const p = partial as Record<string, unknown>;
      const isFilePartial =
        "content" in p ||
        "isDirty" in p ||
        "filePath" in p ||
        "fileName" in p ||
        "externallyModified" in p;
      if (!isFilePartial) return data;
      const d = data as FileTabData;
      return {
        kind: "file" as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
        content: p.content !== undefined ? (p.content as FileContent) : d.content,
        isDirty: p.isDirty !== undefined ? (p.isDirty as boolean) : d.isDirty,
        externallyModified: "externallyModified" in p ? (p.externallyModified as boolean | undefined) : d.externallyModified,
      };
    }
    case "diff": {
      const p = partial as Record<string, unknown>;
      if (!("diffSource" in p)) return data;
      const d = data as DiffTabData;
      return {
        kind: "diff" as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
        diffSource: p.diffSource !== undefined ? (p.diffSource as DiffSource) : d.diffSource,
        initialMode: p.initialMode !== undefined ? (p.initialMode as ViewMode | undefined) : d.initialMode,
      };
    }
    case "gitLog": {
      return { kind: "gitLog" as const };
    }
    case "html-preview": {
      const p = partial as Record<string, unknown>;
      if (!("filePath" in p)) return data;
      const d = data as HtmlPreviewTabData;
      return {
        kind: "html-preview" as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
      };
    }
    case "conversation": {
      return data;
    }
    case "prDetail": {
      const p = partial as Record<string, unknown>;
      const d = data as PRDetailTabData;
      return {
        kind: "prDetail" as const,
        projectId: p.projectId !== undefined ? (p.projectId as string) : d.projectId,
        prNumber: p.prNumber !== undefined ? (p.prNumber as number) : d.prNumber,
        prTitle: p.prTitle !== undefined ? (p.prTitle as string) : d.prTitle,
        prState: p.prState !== undefined ? (p.prState as string) : d.prState,
        prBody: p.prBody !== undefined ? (p.prBody as string | null) : d.prBody,
        prAuthor: p.prAuthor !== undefined ? (p.prAuthor as string) : d.prAuthor,
        prCreatedAt: p.prCreatedAt !== undefined ? (p.prCreatedAt as string) : d.prCreatedAt,
        prUrl: p.prUrl !== undefined ? (p.prUrl as string) : d.prUrl,
        prHeadRef: p.prHeadRef !== undefined ? (p.prHeadRef as string) : d.prHeadRef,
        prBaseRef: p.prBaseRef !== undefined ? (p.prBaseRef as string) : d.prBaseRef,
      };
    }
  }
}

function clearPreviousPin(
  layout: EditorSplitLayout,
  prevPinnedId: string | null,
  newTabId: string,
): EditorSplitLayout {
  if (!prevPinnedId || prevPinnedId === newTabId) return layout;
  const leftIds = [prevPinnedId, ...layout.groups.left.tabIds.filter((id) => id !== prevPinnedId)];
  return {
    ...layout,
    pinnedTabId: null,
    groups: {
      ...layout.groups,
      left: {
        tabIds: leftIds,
        activeTabId: layout.groups.left.activeTabId ?? prevPinnedId,
      },
    },
  };
}

function applyPin(layout: EditorSplitLayout, tabId: string): EditorSplitLayout {
  const newLeftIds  = layout.groups.left.tabIds.filter((id) => id !== tabId);
  const newRightIds = layout.groups.right.tabIds.filter((id) => id !== tabId);
  const stillSplit  = layout.isSplit && newRightIds.length > 0;

  return {
    ...layout,
    isSplit: stillSplit,
    activeGroupId: stillSplit ? layout.activeGroupId : "left",
    pinnedTabId: tabId,
    groups: {
      left: {
        tabIds: newLeftIds,
        activeTabId:
          layout.groups.left.activeTabId === tabId
            ? (newLeftIds.length > 0 ? newLeftIds[newLeftIds.length - 1] : null)
            : layout.groups.left.activeTabId,
      },
      right: {
        tabIds: newRightIds,
        activeTabId:
          layout.groups.right.activeTabId === tabId
            ? (newRightIds.length > 0 ? newRightIds[newRightIds.length - 1] : null)
            : layout.groups.right.activeTabId,
      },
    },
  };
}

interface PendingNavigateTarget {
  tabKey: string;
  tabId: string;
  line: number;
  col: number;
}

interface EditorStoreState {
  tabs: Record<string, ProjectTabs>;
  activeTabId: string | null;
  editorLayout: Record<string, EditorSplitLayout>;
  cursorPosition: { line: number; col: number } | null;
  pendingNavigateTarget: PendingNavigateTarget | null;

  addTab: (projectId: string, tab: Tab) => void;
  closeTab: (projectId: string, tabId: string) => void;
  activateTab: (projectId: string, tabId: string) => void;
  updateTab: (projectId: string, tabId: string, partial: Partial<TabData> & { title?: string }) => void;
  clearProjectTabs: (projectId: string) => void;

  splitRight: (tabKey: string, tabId: string) => void;
  moveToRight: (tabKey: string, tabId: string) => void;
  moveToLeft: (tabKey: string, tabId: string) => void;
  unsplit: (tabKey: string) => void;
  setActiveGroup: (tabKey: string, groupId: EditorGroupId) => void;
  setSplitRatio: (tabKey: string, ratio: number) => void;

  reorderTab: (tabKey: string, groupId: EditorGroupId, tabId: string, overId: string) => void;

  pinTab: (tabKey: string, tabId: string) => void;
  unpinTab: (tabKey: string) => void;
  setPinnedPanelRatio: (tabKey: string, ratio: number) => void;

  setCursorPosition: (pos: { line: number; col: number } | null) => void;
  setPendingNavigateTarget: (target: PendingNavigateTarget | null) => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  tabs: {},
  activeTabId: null,
  editorLayout: {},
  cursorPosition: null,
  pendingNavigateTarget: null,

  addTab: (projectId, tab) =>
    set((state) => {
      const existing = state.tabs[projectId];

      if (tab.data.kind === "terminal") {
        const terminalCount = (existing?.tabs ?? []).filter(
          (t) => t.data.kind === "terminal",
        ).length;
        if (terminalCount >= 10) return state;
      }

      if (existing?.tabs.some((t) => t.id === tab.id)) return state;

      const projectTabs: ProjectTabs = existing
        ? { tabs: [...existing.tabs, tab], activeTabId: tab.id }
        : { tabs: [tab], activeTabId: tab.id };

      const newTabs = { ...state.tabs, [projectId]: projectTabs };

      const layout = ensureLayout(state.editorLayout, projectId, projectTabs.tabs.map(t => t.id), tab.id);
      const activeGroupId = layout.activeGroupId;
      const newLayout: EditorSplitLayout = {
        ...layout,
        groups: {
          ...layout.groups,
          [activeGroupId]: {
            ...layout.groups[activeGroupId],
            tabIds: layout.groups[activeGroupId].tabIds.includes(tab.id)
              ? layout.groups[activeGroupId].tabIds
              : [...layout.groups[activeGroupId].tabIds, tab.id],
            activeTabId: tab.id,
          },
        },
      };

      return {
        tabs: newTabs,
        activeTabId: tab.id,
        editorLayout: { ...state.editorLayout, [projectId]: newLayout },
      };
    }),

  closeTab: (projectId, tabId) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      const idx = existing.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;

      if (state.editorLayout[projectId]?.pinnedTabId === tabId) return state;

      const remaining = existing.tabs.filter((t) => t.id !== tabId);
      let newActiveId: string | null = existing.activeTabId;

      if (existing.activeTabId === tabId) {
        if (remaining.length === 0) {
          newActiveId = null;
        } else {
          const layout = state.editorLayout[projectId];
          let groupId: EditorGroupId = "left";
          if (layout?.groups.right.tabIds.includes(tabId)) groupId = "right";
          const groupIds = layout?.groups[groupId]?.tabIds;
          const groupIdx = groupIds?.indexOf(tabId) ?? -1;

          if (groupIdx > 0) {
            newActiveId = groupIds![groupIdx - 1];
          } else if (groupIdx >= 0 && groupIds && groupIds.length > 1) {
            newActiveId = groupIds[groupIdx + 1];
          } else {
            newActiveId = remaining[remaining.length - 1].id;
          }
        }
      }

      const globalActiveId =
        state.activeTabId === tabId ? newActiveId : state.activeTabId;

      const newTabs = {
        ...state.tabs,
        [projectId]: { tabs: remaining, activeTabId: newActiveId },
      };

      let newEditorLayout = state.editorLayout;
      const layout = state.editorLayout[projectId];
      if (layout) {
        let groupId: EditorGroupId = "left";
        if (layout.groups.right.tabIds.includes(tabId)) groupId = "right";

        const updatedGroupIds = layout.groups[groupId].tabIds.filter(id => id !== tabId);
        let newLayout: EditorSplitLayout = {
          ...layout,
          groups: {
            ...layout.groups,
            [groupId]: {
              ...layout.groups[groupId],
              tabIds: updatedGroupIds,
              activeTabId: layout.groups[groupId].activeTabId === tabId
                ? (updatedGroupIds.length > 0 ? updatedGroupIds[updatedGroupIds.length - 1] : null)
                : layout.groups[groupId].activeTabId,
            },
          },
        };

        if (newLayout.isSplit && newLayout.groups.right.tabIds.length === 0) {
          newLayout = {
            ...newLayout,
            isSplit: false,
            activeGroupId: "left",
          };
        }

        if (newLayout.isSplit && newLayout.groups.left.tabIds.length === 0) {
          newLayout = {
            ...newLayout,
            isSplit: false,
            activeGroupId: "left",
            groups: {
              left: newLayout.groups.right,
              right: { tabIds: [], activeTabId: null },
            },
          };
        }

        newEditorLayout = { ...state.editorLayout, [projectId]: newLayout };
      }

      return {
        tabs: newTabs,
        activeTabId: globalActiveId,
        editorLayout: newEditorLayout,
      };
    }),

  activateTab: (projectId, tabId) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      if (!existing.tabs.some((t) => t.id === tabId)) return state;

      let newEditorLayout = state.editorLayout;
      const layout = state.editorLayout[projectId];
      if (layout) {
        let groupId: EditorGroupId = layout.activeGroupId;
        if (layout.groups.right.tabIds.includes(tabId)) groupId = "right";
        else if (layout.groups.left.tabIds.includes(tabId)) groupId = "left";
        newEditorLayout = {
          ...state.editorLayout,
          [projectId]: {
            ...layout,
            activeGroupId: groupId,
            groups: {
              ...layout.groups,
              [groupId]: {
                ...layout.groups[groupId],
                activeTabId: tabId,
              },
            },
          },
        };
      }

      return {
        tabs: {
          ...state.tabs,
          [projectId]: { ...existing, activeTabId: tabId },
        },
        activeTabId: tabId,
        editorLayout: newEditorLayout,
      };
    }),

  updateTab: (projectId, tabId, partial) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      const target = existing.tabs.find((t) => t.id === tabId);
      if (!target) return state;

      const updatedData = mergeTabData(target.data, partial);
      const updatedTab: Tab = {
        ...target,
        data: updatedData,
        title: partial.title !== undefined ? partial.title : target.title,
      };

      return {
        tabs: {
          ...state.tabs,
          [projectId]: {
            ...existing,
            tabs: existing.tabs.map((t) => (t.id === tabId ? updatedTab : t)),
          },
        },
      };
    }),

  clearProjectTabs: (projectId) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      const globalActiveId =
        existing.tabs.some((t) => t.id === state.activeTabId)
          ? null
          : state.activeTabId;

      const { [projectId]: _, ...rest } = state.tabs;
      const { [projectId]: __, ...restLayouts } = state.editorLayout;
      return { tabs: rest, activeTabId: globalActiveId, editorLayout: restLayouts };
    }),

  splitRight: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(state.editorLayout, tabKey, projectTabs.tabs.map(t => t.id), projectTabs.activeTabId);

      const newLeftIds = layout.groups.left.tabIds.filter(id => id !== tabId);
      const newRightIds = layout.isSplit
        ? (layout.groups.right.tabIds.includes(tabId)
          ? layout.groups.right.tabIds
          : [...layout.groups.right.tabIds, tabId])
        : [tabId];

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: true,
        activeGroupId: "right",
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId: layout.groups.left.activeTabId === tabId
              ? (newLeftIds.length > 0 ? newLeftIds[newLeftIds.length - 1] : null)
              : layout.groups.left.activeTabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: tabId,
          },
        },
      };

      return {
        activeTabId: tabId,
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  moveToRight: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(state.editorLayout, tabKey, projectTabs.tabs.map(t => t.id), projectTabs.activeTabId);

      if (layout.groups.right.tabIds.includes(tabId)) return state;

      const newLeftIds = layout.groups.left.tabIds.filter(id => id !== tabId);
      const newRightIds = [...layout.groups.right.tabIds, tabId];

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: true,
        activeGroupId: "right",
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId: layout.groups.left.activeTabId === tabId
              ? (newLeftIds.length > 0 ? newLeftIds[newLeftIds.length - 1] : null)
              : layout.groups.left.activeTabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: tabId,
          },
        },
      };

      return {
        activeTabId: tabId,
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  moveToLeft: (tabKey, tabId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      if (layout.groups.left.tabIds.includes(tabId)) return state;

      const newRightIds = layout.groups.right.tabIds.filter(id => id !== tabId);
      const newLeftIds = [...layout.groups.left.tabIds, tabId];

      let newLayout: EditorSplitLayout = {
        ...layout,
        activeGroupId: "left",
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId: tabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: newRightIds.length > 0 ? newRightIds[newRightIds.length - 1] : null,
          },
        },
      };

      if (newLayout.groups.right.tabIds.length === 0) {
        newLayout = { ...newLayout, isSplit: false };
      }

      return {
        activeTabId: tabId,
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  unsplit: (tabKey) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || !layout.isSplit) return state;

      const allTabIds = [...layout.groups.left.tabIds, ...layout.groups.right.tabIds];
      const activeTabId = layout.activeGroupId === "right"
        ? layout.groups.right.activeTabId
        : layout.groups.left.activeTabId;

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: false,
        activeGroupId: "left",
        groups: {
          left: { tabIds: allTabIds, activeTabId: activeTabId ?? allTabIds[allTabIds.length - 1] ?? null },
          right: { tabIds: [], activeTabId: null },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setActiveGroup: (tabKey, groupId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || layout.activeGroupId === groupId) return state;

      const newLayout: EditorSplitLayout = {
        ...layout,
        activeGroupId: groupId,
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setSplitRatio: (tabKey, ratio) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      const clamped = Math.max(0.3, Math.min(0.7, ratio));
      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: { ...layout, ratio: clamped },
        },
      };
    }),

  reorderTab: (tabKey, groupId, tabId, overId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;
      const group = layout.groups[groupId];
      if (!group) return state;

      const oldIndex = group.tabIds.indexOf(tabId);
      const newIndex = group.tabIds.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return state;

      const newTabIds = [...group.tabIds];
      newTabIds.splice(oldIndex, 1);
      newTabIds.splice(newIndex, 0, tabId);

      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: {
            ...layout,
            groups: {
              ...layout.groups,
              [groupId]: {
                ...group,
                tabIds: newTabIds,
              },
            },
          },
        },
      };
    }),

  pinTab: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(
        state.editorLayout,
        tabKey,
        projectTabs.tabs.map((t) => t.id),
        projectTabs.activeTabId,
      );

      const newLayout = applyPin(
        clearPreviousPin(layout, layout.pinnedTabId, tabId),
        tabId,
      );

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  unpinTab: (tabKey) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || !layout.pinnedTabId) return state;

      const pinnedId = layout.pinnedTabId;

      const leftIds = [pinnedId, ...layout.groups.left.tabIds.filter((id) => id !== pinnedId)];

      const newLayout: EditorSplitLayout = {
        ...layout,
        pinnedTabId: null,
        groups: {
          ...layout.groups,
          left: {
            tabIds: leftIds,
            activeTabId: layout.groups.left.activeTabId ?? pinnedId,
          },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setPinnedPanelRatio: (tabKey, ratio) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      const clamped = Math.max(0.1, Math.min(0.75, ratio));
      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: { ...layout, pinnedPanelRatio: clamped },
        },
      };
    }),

  setCursorPosition: (pos) => set(() => ({ cursorPosition: pos })),

  setPendingNavigateTarget: (target) => set(() => ({ pendingNavigateTarget: target })),
}));
