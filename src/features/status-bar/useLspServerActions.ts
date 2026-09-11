/** LSP 会话操作（重启 / 停止 / 查看日志）—— 抽自 `LspStatusSection`。 */

import {
  lspRestartAllSessions,
  lspRestartSession,
  lspStopAllSessions,
  lspStopSession,
} from '@/features/lsp/api/lspApi';
import { useLspStore, type LspSessionState } from '@/features/lsp/store/lspStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useTaskStore } from '@/shared/store/taskStore';

import { serverName } from './lspStatusFormat';

interface Params {
  activeProjectPath: string | undefined;
  activeProjectId: string | null;
  sessionEntries: LspSessionState[];
  closeAll: () => void;
}

export function useLspServerActions({
  activeProjectPath,
  activeProjectId,
  sessionEntries,
  closeAll,
}: Params) {
  const openLspLogConsole = useTaskStore((s) => s.openLspLogConsole);

  const notifyError = (title: string, e: unknown) => {
    useNotificationStore.getState().addNotification({
      type: 'error',
      title,
      message: String(e),
    });
  };

  const handleRestart = async (languageId: string) => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    const name = sessionEntries.find((s) => s.languageId === languageId)?.serverName;
    closeAll();
    store.setSessionState(activeProjectPath, languageId, {
      status: 'starting',
      serverName: name,
      statusMessage: 'Restarting...',
    });
    try {
      await lspRestartSession(activeProjectPath, languageId);
    } catch (e) {
      console.error('[LSP] Restart failed:', e);
      store.setSessionState(activeProjectPath, languageId, {
        status: 'error',
        statusMessage: String(e),
      });
      notifyError('LSP Restart Failed', e);
    }
  };

  const handleStop = async (languageId: string) => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    closeAll();
    store.removeSession(activeProjectPath, languageId);
    try {
      await lspStopSession(activeProjectPath, languageId);
    } catch (e) {
      console.error('[LSP] Stop failed:', e);
      notifyError('LSP Stop Failed', e);
    }
  };

  const handleRestartAll = async () => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    const languages = sessionEntries.map((s) => s.languageId);
    closeAll();
    for (const languageId of languages) {
      const name = sessionEntries.find((s) => s.languageId === languageId)?.serverName;
      store.setSessionState(activeProjectPath, languageId, {
        status: 'starting',
        serverName: name,
        statusMessage: 'Restarting...',
      });
    }
    try {
      await lspRestartAllSessions(activeProjectPath);
    } catch (e) {
      console.error('[LSP] Restart all failed:', e);
      notifyError('LSP Restart All Failed', e);
    }
  };

  const handleStopAll = async () => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    const languages = sessionEntries.map((s) => s.languageId);
    closeAll();
    for (const languageId of languages) {
      store.removeSession(activeProjectPath, languageId);
    }
    try {
      await lspStopAllSessions(activeProjectPath);
    } catch (e) {
      console.error('[LSP] Stop all failed:', e);
      notifyError('LSP Stop All Failed', e);
    }
  };

  const handleViewLogs = async (session: LspSessionState) => {
    if (!activeProjectId || !activeProjectPath) return;
    closeAll();
    try {
      await openLspLogConsole({
        projectId: activeProjectId,
        projectPath: activeProjectPath,
        languageId: session.languageId,
        serverName: serverName(session.languageId, session.serverName),
      });
    } catch (e) {
      console.error('[LSP] View logs failed:', e);
      notifyError('LSP View Logs Failed', e);
    }
  };

  return { handleRestart, handleStop, handleRestartAll, handleStopAll, handleViewLogs };
}
