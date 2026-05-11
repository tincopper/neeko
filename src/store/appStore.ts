import { create } from "zustand";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
  AuthMethod,
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
}

const noop = () => {};

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

      return {
        tabs: { ...state.tabs, [projectId]: projectTabs },
        activeTabId: tab.id,
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

      return {
        tabs: {
          ...state.tabs,
          [projectId]: { tabs: remaining, activeTabId: newActiveId },
        },
        activeTabId: globalActiveId,
      };
    }),

  activateTab: (projectId, tabId) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      // Ensure tabId belongs to this project
      if (!existing.tabs.some((t) => t.id === tabId)) return state;

      return {
        tabs: {
          ...state.tabs,
          [projectId]: { ...existing, activeTabId: tabId },
        },
        activeTabId: tabId,
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
      return { tabs: rest, activeTabId: globalActiveId };
    }),
}));
