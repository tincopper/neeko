import { create } from "zustand";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
  AuthMethod,
  EditorGroupId,
  EditorSplitLayout,
  FileNode,
  Project,
  ProjectTabs,
  RemoteEntrySession,
  RemoteProject,
  Tab,
  TabData,
  WSLEntrySession,
  WSLProject,
} from "../types";
import { createDefaultEditorLayout } from "../types/editorGroup";

export interface WorktreeSnapshotItem {
  path: string;
  branch: string;
}

interface IdeProject {
  id: string;
  selected_ide: string | null;
}

interface AppStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  activeWslProject: { distro: string; project: WSLProject } | null;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  openedWorktrees: WorktreeSnapshotItem[];
  wslOpenedWt: WorktreeSnapshotItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeSnapshotItem[];
  activeRemoteWorktreePath: string | null;
  worktreeState: Record<string, string>;
  fileTree: FileNode[];
  fileViewLoading: boolean;
  activeFilePath: string | null;

  // ── Per-project unified tabs ──
  tabs: Record<string, ProjectTabs>;
  activeTabId: string | null;

  // ── Editor group split layout ──
  editorLayout: Record<string, EditorSplitLayout>;

  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
  openIde: (project: IdeProject) => void;

  // ── Tab CRUD actions ──
  addTab: (projectId: string, tab: Tab) => void;
  closeTab: (projectId: string, tabId: string) => void;
  activateTab: (projectId: string, tabId: string) => void;
  updateTab: (projectId: string, tabId: string, partial: Partial<TabData> & { title?: string }) => void;
  clearProjectTabs: (projectId: string) => void;

  // ── Editor group actions ──
  splitRight: (tabKey: string, tabId: string) => void;
  moveToRight: (tabKey: string, tabId: string) => void;
  moveToLeft: (tabKey: string, tabId: string) => void;
  unsplit: (tabKey: string) => void;
  setActiveGroup: (tabKey: string, groupId: EditorGroupId) => void;
  setSplitRatio: (tabKey: string, ratio: number) => void;
}

const noop = () => {};

function ensureLayout(layouts: Record<string, EditorSplitLayout>, tabKey: string, allTabIds: string[], activeTabId: string | null): EditorSplitLayout {
  if (layouts[tabKey]) return layouts[tabKey];
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = allTabIds;
  layout.groups.left.activeTabId = activeTabId;
  return layout;
}

/**
 * Type-safe shallow merge of partial data into a TabData variant.
 * Uses `in` operator to narrow the discriminated union — no `as` cast needed.
 */
function mergeTabData(data: TabData, partial: Partial<TabData>): TabData {
  // Reject kind mismatch
  if (partial.kind !== undefined && partial.kind !== data.kind) {
    return data;
  }

  switch (data.kind) {
    case "terminal": {
      // `in` narrows partial to the only member that has `agentId`: Partial<TerminalTabData>
      if (!("agentId" in partial)) return data;
      return {
        kind: "terminal",
        agentId: partial.agentId !== undefined ? partial.agentId : data.agentId,
        status: partial.status !== undefined ? partial.status : data.status,
      };
    }
    case "file": {
      // `in` narrows partial to the only member that has `content`: Partial<FileTabData>
      if (!("content" in partial)) return data;
      return {
        kind: "file",
        filePath: partial.filePath !== undefined ? partial.filePath : data.filePath,
        fileName: partial.fileName !== undefined ? partial.fileName : data.fileName,
        content: partial.content !== undefined ? partial.content : data.content,
        isDirty: partial.isDirty !== undefined ? partial.isDirty : data.isDirty,
      };
    }
    case "diff": {
      // `in` narrows partial to the only member that has `diffSource`: Partial<DiffTabData>
      if (!("diffSource" in partial)) return data;
      return {
        kind: "diff",
        filePath: partial.filePath !== undefined ? partial.filePath : data.filePath,
        fileName: partial.fileName !== undefined ? partial.fileName : data.fileName,
        diffSource: partial.diffSource !== undefined ? partial.diffSource : data.diffSource,
        initialMode: partial.initialMode !== undefined ? partial.initialMode : data.initialMode,
      };
    }
    case "settings": {
      return { kind: "settings" };
    }
    case "gitLog": {
      return { kind: "gitLog" };
    }
    case "html-preview": {
      if (!("filePath" in partial)) return data;
      return {
        kind: "html-preview",
        filePath: partial.filePath !== undefined ? partial.filePath : data.filePath,
        fileName: partial.fileName !== undefined ? partial.fileName : data.fileName,
      };
    }
  }
}

export const useAppStore = create<AppStoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,
  wslEntries: [],
  activeWslKey: null,
  activeWslProject: null,
  remoteEntries: [],
  activeRemoteKey: null,
  activeRemoteProject: null,
  remoteAuthStore: new Map(),
  pendingAuthEntry: null,
  activeWorktreePath: null,
  activeWorktreeBranch: "",
  openedWorktrees: [],
  wslOpenedWt: [],
  activeWslWorktreePath: null,
  remoteOpenedWt: [],
  activeRemoteWorktreePath: null,
  worktreeState: {},
  fileTree: [],
  fileViewLoading: false,
  activeFilePath: null,
  tabs: {},
  activeTabId: null,
  editorLayout: {},
  selectProject: noop,
  selectWslProject: noop,
  selectRemoteProject: noop,
  openIde: noop,

  // ── Tab CRUD actions ──

  addTab: (projectId, tab) =>
    set((state) => {
      const existing = state.tabs[projectId];

      // Terminal tabs: enforce max 10 per project
      if (tab.data.kind === "terminal") {
        const terminalCount = (existing?.tabs ?? []).filter(
          (t) => t.data.kind === "terminal",
        ).length;
        if (terminalCount >= 10) return state;
      }

      // Prevent duplicate tab id
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
            tabIds: [...layout.groups[activeGroupId].tabIds, tab.id],
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

      const remaining = existing.tabs.filter((t) => t.id !== tabId);
      let newActiveId: string | null = existing.activeTabId;

      if (existing.activeTabId === tabId) {
        if (remaining.length === 0) {
          newActiveId = null;
        } else {
          // Activate the next tab, or the previous one if at the end
          const nextIdx = idx < remaining.length ? idx : remaining.length - 1;
          newActiveId = remaining[nextIdx].id;
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

      // Ensure tabId belongs to this project
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

  // ── Editor group actions ──

  splitRight: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(state.editorLayout, tabKey, projectTabs.tabs.map(t => t.id), projectTabs.activeTabId);

      const newLeftIds = layout.groups.left.tabIds.filter(id => id !== tabId);
      const newRightIds = layout.isSplit
        ? [...layout.groups.right.tabIds, tabId]
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
}));
