import React, { useCallback, useEffect } from 'react';

import { RemoteAuthDialog, RemoteDialog, WSLDialog } from '@/features/connection';
import { CloseConfirmDialog } from '@/features/editor';
import {
  setCloseConfirmHostMounted,
  useCloseConfirmStore,
} from '@/features/editor/store/closeConfirmStore';
import { PromptDialogHost } from '@/features/library';
import { CloneProjectDialog } from '@/features/project';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import ConfirmHost from '@/shared/components/ConfirmHost';
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';
import { IS_WINDOWS } from '@/shared/utils/platform';

interface AppModalsProps {
  cloneDialogOpen: boolean;
  onCloneDialogClose: () => void;
  onCloneSuccess: (path: string) => void;

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
  cloneDialogOpen,
  onCloneDialogClose,
  onCloneSuccess,
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
  const closeConfirmPending = useCloseConfirmStore((s) => s.pending);
  const resolveCloseConfirm = useCloseConfirmStore((s) => s.resolve);
  const onCloseConfirmSave = useCallback(() => resolveCloseConfirm('save'), [resolveCloseConfirm]);
  const onCloseConfirmDiscard = useCallback(
    () => resolveCloseConfirm('discard'),
    [resolveCloseConfirm],
  );
  const onCloseConfirmCancel = useCallback(
    () => resolveCloseConfirm('cancel'),
    [resolveCloseConfirm],
  );

  // 本组件是 close-confirm 的唯一渲染点：挂载即声明就绪，卸载时把在途请求按 cancel 结算 ——
  // 否则 `closeTabWithConfirmation` 的 await 永久挂起（见 closeConfirmStore 的 hostMounted）。
  useEffect(() => {
    setCloseConfirmHostMounted(true);
    return () => {
      setCloseConfirmHostMounted(false);
      useCloseConfirmStore.getState().resolve('cancel');
    };
  }, []);

  const unsavedCount = unsavedFileNames.length;
  const unsavedPreview = unsavedFileNames.slice(0, 3).join(', ');
  return (
    <>
      <CloneProjectDialog
        isOpen={cloneDialogOpen}
        onClose={onCloneDialogClose}
        onSuccess={onCloneSuccess}
      />

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
      {/* 未保存关闭确认对话框（全局单例：TabBar X / 菜单 Close Tab / Cmd+W 三条关闭路径共用） */}
      <CloseConfirmDialog
        open={closeConfirmPending !== null}
        fileName={closeConfirmPending?.fileName ?? ''}
        onSave={onCloseConfirmSave}
        onDiscard={onCloseConfirmDiscard}
        onCancel={onCloseConfirmCancel}
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
      {/* 通用确认宿主（store 驱动）：非 React 模块（runner / store action）经
          `confirmAction` 询问用户时的唯一渲染点。 */}
      <ConfirmHost />
      {/* Prompt 弹窗宿主（store 驱动）：触发点在状态栏/命令面板，与中心视图无关，
          故渲染点必须常驻本组合层（见 `PromptDialogHost` 模块注释）。 */}
      <PromptDialogHost />
    </>
  );
}

export default React.memo(AppModals);
