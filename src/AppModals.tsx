import React from "react";
import { IS_WINDOWS } from "./utils/platform";
import { AddProjectModal } from "./components/project";
import {
  WSLDialog,
  RemoteDialog,
  RemoteAuthDialog,
} from "./components/connections";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "./types";

interface AddProjectModalProps {
  pendingPath: string | null;
  onConfirm: React.ComponentProps<typeof AddProjectModal>["onConfirm"];
  onCancel: () => void;
  loading: boolean;
}

interface WslModalProps {
  open: boolean;
  onClose: () => void;
  onAddWslEntry: (entry: WSLEntrySession) => void;
  entries: WSLEntrySession[];
  addToEntryId: string | null;
}

interface RemoteModalProps {
  open: boolean;
  onClose: () => void;
  onAddRemoteEntry: (
    entry: RemoteEntrySession,
    auth: AuthMethod | null,
    saved_auth?: string | null,
  ) => void;
  entries: RemoteEntrySession[];
  addToEntryId: string | null;
  authStore: Map<string, AuthMethod>;
}

interface RemoteAuthModalProps {
  pendingAuthEntry: RemoteEntrySession | null;
  onCancel: () => void;
  onSuccess: (auth: AuthMethod, saved_auth?: string | null) => void;
}

interface AppModalsProps {
  addProject: AddProjectModalProps;
  wsl: WslModalProps;
  remote: RemoteModalProps;
  remoteAuth: RemoteAuthModalProps;
}

function AppModals({
  addProject,
  wsl,
  remote,
  remoteAuth,
}: AppModalsProps) {
  return (
    <>
      {addProject.pendingPath && (
        <AddProjectModal
          pendingPath={addProject.pendingPath}
          onConfirm={addProject.onConfirm}
          onCancel={addProject.onCancel}
          loading={addProject.loading}
        />
      )}

      {IS_WINDOWS && (
        <WSLDialog
          isOpen={wsl.open}
          onClose={wsl.onClose}
          onAdd={wsl.onAddWslEntry}
          existingEntries={wsl.entries}
          selectedEntryId={wsl.addToEntryId ?? undefined}
        />
      )}

      <RemoteDialog
        isOpen={remote.open}
        onClose={remote.onClose}
        onAdd={remote.onAddRemoteEntry}
        existingEntries={remote.entries}
        addProjectMode={remote.addToEntryId !== null}
        selectedEntryId={remote.addToEntryId ?? undefined}
        existingEntryAuth={remote.authStore}
      />

      {remoteAuth.pendingAuthEntry && (
        <RemoteAuthDialog
          isOpen={true}
          host={remoteAuth.pendingAuthEntry.host}
          port={remoteAuth.pendingAuthEntry.port}
          username={remoteAuth.pendingAuthEntry.username}
          onCancel={remoteAuth.onCancel}
          onSuccess={remoteAuth.onSuccess}
        />
      )}
    </>
  );
}

export default React.memo(AppModals);
