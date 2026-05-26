import { useCallback } from "react";
import type { AuthMethod } from "../types";
import { useConnectionStore } from "../store/connectionStore";
import type { SaveSessionFn } from "./useWslProjects";

interface UseRemoteAuthActionsParams {
  saveSession: SaveSessionFn;
}

interface UseRemoteAuthActionsResult {
  handleRemoteAuthCancel: () => void;
  handleRemoteAuthSuccess: (auth: AuthMethod, saved_auth?: string | null) => void;
}

export function useRemoteAuthActions({ saveSession }: UseRemoteAuthActionsParams): UseRemoteAuthActionsResult {
  const handleRemoteAuthCancel = useCallback(() => {
    useConnectionStore.setState({
      pendingAuthEntry: null,
      activeRemoteKey: null,
      activeRemoteProject: null,
    });
  }, []);

  const handleRemoteAuthSuccess = useCallback((auth: AuthMethod, saved_auth?: string | null) => {
    const snapshot = useConnectionStore.getState();
    const pending = snapshot.pendingAuthEntry;
    if (!pending) {
      return;
    }

    const entryId = pending.id;
    useConnectionStore.setState((state) => ({
      remoteAuthStore: new Map(state.remoteAuthStore).set(entryId, auth),
      pendingAuthEntry: null,
    }));

    if (!saved_auth) {
      return;
    }

    const updatedEntries = snapshot.remoteEntries.map((entry) => (
      entry.id === entryId
        ? { ...entry, saved_auth }
        : entry
    ));

    useConnectionStore.setState({
      remoteEntries: updatedEntries,
    });

    saveSession(undefined, updatedEntries).catch(console.error);
  }, [saveSession]);

  return {
    handleRemoteAuthCancel,
    handleRemoteAuthSuccess,
  };
}
