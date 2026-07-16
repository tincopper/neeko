import { create } from "zustand";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';

interface ConnectionStoreState {
  wslEntries: WSLEntrySession[];
  remoteEntries: RemoteEntrySession[];
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
}

export const useConnectionStore = create<ConnectionStoreState>(() => ({
  wslEntries: [],
  remoteEntries: [],
  remoteAuthStore: new Map(),
  pendingAuthEntry: null,
}));
