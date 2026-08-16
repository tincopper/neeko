import React from 'react';

import { RemoteAuthDialog, RemoteDialog, WSLDialog } from '@/features/connection';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
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

  confirmExitOpen: boolean;
  onConfirmExit: () => void;
  onCancelExit: () => void;
  /** 退出时仍未保存的文件名列表（用于退出确认框警示） */
  unsavedFileNames?: string[];
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
  confirmExitOpen,
  onConfirmExit,
  onCancelExit,
  unsavedFileNames = [],
}: AppModalsProps) {
  const unsavedCount = unsavedFileNames.length;
  const unsavedPreview = unsavedFileNames.slice(0, 3).join(', ');
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

      <ConfirmDialog
        open={confirmExitOpen}
        onOpenChange={onCancelExit}
        title="Exit Neeko?"
        description={
          <>
            {unsavedCount > 0 ? (
              <p className="mb-2 text-red-500">
                You have unsaved changes in {unsavedCount} file{unsavedCount > 1 ? 's' : ''} (
                {unsavedPreview}
                {unsavedCount > 3 ? ', etc.' : ''}). Quitting will lose these changes.
              </p>
            ) : null}
            Any running terminals and background processes will be stopped.
            <br />
            Are you sure you want to quit?
          </>
        }
        confirmLabel="Exit"
        onConfirm={onConfirmExit}
      />
    </>
  );
}

export default React.memo(AppModals);
