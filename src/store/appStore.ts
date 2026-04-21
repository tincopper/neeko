import { create } from "zustand";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
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

interface AppStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  activeWorktreePath: string | null;
  openedWorktrees: WorktreeSnapshotItem[];
  wslOpenedWt: WorktreeSnapshotItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeSnapshotItem[];
  activeRemoteWorktreePath: string | null;
  worktreeState: Record<string, string>;
  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
  openIde: (project: IdeProject) => void;
}

const noop = () => {};

export const useAppStore = create<AppStoreState>(() => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,
  wslEntries: [],
  activeWslKey: null,
  remoteEntries: [],
  activeRemoteKey: null,
  activeWorktreePath: null,
  openedWorktrees: [],
  wslOpenedWt: [],
  activeWslWorktreePath: null,
  remoteOpenedWt: [],
  activeRemoteWorktreePath: null,
  worktreeState: {},
  selectProject: noop,
  selectWslProject: noop,
  selectRemoteProject: noop,
  openIde: noop,
}));
