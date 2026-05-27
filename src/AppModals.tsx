import React from "react";
import { IS_WINDOWS } from "./utils/platform";
import { AddProjectModal } from "./components/project";
import {
  WSLDialog,
  RemoteDialog,
  RemoteAuthDialog,
} from "./components/connections";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "./types";

interface AppModalsProps {
  pendingPath: string | null;
  onConfirmAddProject: (agentId: string | null, ideCommand: string | null) => Promise<void>;
  onCancelAddProject: () => void;
  loading: boolean;

  wslDialogOpen: boolean;
  onWslDialogClose: () => void;
  onAddWslEntry: (entry: WSLEntrySession) => void;
  wslEntries: WSLEntrySession[];
  wslAddToEntryId: string | null;

  remoteDialogOpen: boolean;
  onRemoteDialogClose: () => void;
  onAddRemoteEntry: (
    entry: RemoteEntrySession,
    auth: AuthMethod | null,
    saved_auth?: string | null,
  ) => void;
  remoteEntries: RemoteEntrySession[];
  remoteAddToEntryId: string | null;
  remoteAuthStore: Map<string, AuthMethod>;

  pendingAuthEntry: RemoteEntrySession | null;
  onRemoteAuthCancel: () => void;
  onRemoteAuthSuccess: (auth: AuthMethod, saved_auth?: string | null) => void;
}

function AppModals({
  pendingPath,
  onConfirmAddProject,
  onCancelAddProject,
  loading,
  wslDialogOpen,
  onWslDialogClose,
  onAddWslEntry,
  wslEntries,
  wslAddToEntryId,
  remoteDialogOpen,
  onRemoteDialogClose,
  onAddRemoteEntry,
  remoteEntries,
  remoteAddToEntryId,
  remoteAuthStore,
  pendingAuthEntry,
  onRemoteAuthCancel,
  onRemoteAuthSuccess,
}: AppModalsProps) {
  return (
    <>
      {pendingPath && (
        <AddProjectModal
          pendingPath={pendingPath}
          onConfirm={onConfirmAddProject}
          onCancel={onCancelAddProject}
          loading={loading}
        />
      )}

      {IS_WINDOWS && (
        <WSLDialog
          isOpen={wslDialogOpen}
          onClose={onWslDialogClose}
          onAdd={onAddWslEntry}
          existingEntries={wslEntries}
          selectedEntryId={wslAddToEntryId ?? undefined}
        />
      )}

      <RemoteDialog
        isOpen={remoteDialogOpen}
        onClose={onRemoteDialogClose}
        onAdd={onAddRemoteEntry}
        existingEntries={remoteEntries}
        addProjectMode={remoteAddToEntryId !== null}
        selectedEntryId={remoteAddToEntryId ?? undefined}
        existingEntryAuth={remoteAuthStore}
      />

      {pendingAuthEntry && (
        <RemoteAuthDialog
          isOpen={true}
          host={pendingAuthEntry.host}
          port={pendingAuthEntry.port}
          username={pendingAuthEntry.username}
          onCancel={onRemoteAuthCancel}
          onSuccess={onRemoteAuthSuccess}
        />
      )}
    </>
  );
}

export default React.memo(AppModals);
