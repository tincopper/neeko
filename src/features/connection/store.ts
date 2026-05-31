import { create } from "zustand";
import type { ActiveRemoteKey, ActiveWslKey } from "./components/types";
import type { AuthMethod, RemoteEntrySession, RemoteProject, WSLEntrySession, WSLProject } from '@/shared/types';

const noop = () => {};

interface ConnectionStoreState {
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  activeWslProject: { distro: string; project: WSLProject } | null;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
}

export const useConnectionStore = create<ConnectionStoreState>(() => ({
  wslEntries: [],
  activeWslKey: null,
  activeWslProject: null,
  remoteEntries: [],
  activeRemoteKey: null,
  activeRemoteProject: null,
  remoteAuthStore: new Map(),
  pendingAuthEntry: null,
  selectWslProject: noop,
  selectRemoteProject: noop,
}));
