import { create } from "zustand";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
  AuthMethod,
  FileNode,
  FileTab,
  Project,
  RemoteEntrySession,
  RemoteProject,
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

export interface WorktreeDiffState {
  worktreePath: string;
  filePath: string;
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
  worktreeDiffState: WorktreeDiffState | null;
  openedWorktrees: WorktreeSnapshotItem[];
  wslOpenedWt: WorktreeSnapshotItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeSnapshotItem[];
  activeRemoteWorktreePath: string | null;
  worktreeState: Record<string, string>;
  fileTree: FileNode[];
  fileTabs: FileTab[];
  activeFileTabId: string | null;
  fileViewLoading: boolean;
  activeFilePath: string | null;
  fileViewOpen: boolean;
  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
  openIde: (project: IdeProject) => void;
  toggleFileView: () => void;
}

const noop = () => {};

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
  worktreeDiffState: null,
  openedWorktrees: [],
  wslOpenedWt: [],
  activeWslWorktreePath: null,
  remoteOpenedWt: [],
  activeRemoteWorktreePath: null,
  worktreeState: {},
  fileTree: [],
  fileTabs: [],
  activeFileTabId: null,
  fileViewLoading: false,
  activeFilePath: null,
  fileViewOpen: true,
  selectProject: noop,
  selectWslProject: noop,
  selectRemoteProject: noop,
  openIde: noop,
  toggleFileView: () => set((state) => ({ fileViewOpen: !state.fileViewOpen })),
}));
