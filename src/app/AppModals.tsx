import React from 'react';

import { RemoteAuthDialog } from '@/features/connection/components/RemoteAuthDialog';
import { RemoteDialog } from '@/features/connection/components/RemoteDialog';
import { WSLDialog } from '@/features/connection/components/WSLDialog';
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';
import { IS_WINDOWS } from '@/shared/utils/platform';

interface AppModalsProps {
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
