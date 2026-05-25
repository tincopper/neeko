import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "../types";
import type AppModals from "../AppModals";

interface UseAppModalsPropsInput {
  pendingPath: string | null;
  handleConfirmAddProject: (agentId: string | null, ideCommand: string | null) => Promise<void>;
  setPendingPath: (path: string | null) => void;
  loading: boolean;
  wslDialogOpen: boolean;
  wslAddToEntryId: string | null;
  wslEntries: WSLEntrySession[];
  handleWslDialogClose: () => void;
  handleWslEntryAdd: (entry: WSLEntrySession) => Promise<void>;
  remoteDialogOpen: boolean;
  remoteAddToEntryId: string | null;
  remoteEntries: RemoteEntrySession[];
  handleRemoteDialogClose: () => void;
  handleRemoteEntryAdd: (
    entry: RemoteEntrySession,
    auth: AuthMethod | null,
    saved_auth?: string | null,
  ) => Promise<void>;
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
  handleRemoteAuthCancel: () => void;
  handleRemoteAuthSuccess: (auth: AuthMethod, saved_auth?: string | null) => void;
}

export function useAppModalsProps(
  input: UseAppModalsPropsInput,
): React.ComponentProps<typeof AppModals> {
  return {
    addProject: {
      pendingPath: input.pendingPath,
      onConfirm: input.handleConfirmAddProject,
      onCancel: () => input.setPendingPath(null),
      loading: input.loading,
    },
    wsl: {
      open: input.wslDialogOpen,
      onClose: input.handleWslDialogClose,
      onAddWslEntry: input.handleWslEntryAdd,
      entries: input.wslEntries,
      addToEntryId: input.wslAddToEntryId,
    },
    remote: {
      open: input.remoteDialogOpen,
      onClose: input.handleRemoteDialogClose,
      onAddRemoteEntry: input.handleRemoteEntryAdd,
      entries: input.remoteEntries,
      addToEntryId: input.remoteAddToEntryId,
      authStore: input.remoteAuthStore,
    },
    remoteAuth: {
      pendingAuthEntry: input.pendingAuthEntry,
      onCancel: input.handleRemoteAuthCancel,
      onSuccess: input.handleRemoteAuthSuccess,
    },
  };
}
