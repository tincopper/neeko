import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { useDebugStore } from '@/features/debug/store/debugStore';
import { lspListSessions, lspRestartSession, lspStopSession } from '@/features/lsp/api/lspApi';
import { useLspStore, type LspSessionState } from '@/features/lsp/store/lspStore';
import { NotificationButton } from '@/features/notification/components/NotificationButton';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { useProjectStore } from '@/features/project/store';
import { useTaskStore } from '@/features/task/store';
import { useEditorStore } from '@/shared/store';
import { Bug, Terminal } from '@/shared/components/icons';
import { cn } from '@/shared/utils/cn';

const BUILTIN_SERVER_NAMES: Record<string, string> = {
  rust: 'rust-analyzer',
  python: 'pyright',
  typescript: 'ts-server',
  javascript: 'ts-server',
  go: 'gopls',
  java: 'jdtls',
  cpp: 'clangd',
  csharp: 'omnisharp',
};

/** Prefer live session/profile server name so custom LSPs display correctly. */
function serverName(
  languageId: string,
  liveName?: string | null,
): string {
  if (liveName && liveName.trim()) return liveName;
  return BUILTIN_SERVER_NAMES[languageId] ?? languageId;
}

interface LspInstallProgressEvent {
  language_id: string;
  phase: 'installing' | 'done' | 'error';
  message: string;
}

export function StatusBar() {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const debugSession = useDebugStore((s) => s.session);
  const debugPanelOpen = useDebugStore((s) => s.panelOpen);
  const toggleDebugPanel = useDebugStore((s) => s.togglePanel);
  const consolePanelOpen = useTaskStore((s) => s.consolePanelOpen);
  const toggleConsolePanel = useTaskStore((s) => s.toggleConsolePanel);
  const consoleSessions = useTaskStore((s) => s.consoleSessions);
  const activeConsoleId = useTaskStore((s) => s.activeConsoleId);
  const runningConsoleCount = consoleSessions.filter((s) => s.status === 'running').length;
  const activeConsole =
    consoleSessions.find((s) => s.id === activeConsoleId) ??
    consoleSessions.find((s) => s.status === 'running') ??
    null;
  const [installProgress, setInstallProgress] = useState<LspInstallProgressEvent | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | undefined>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const subscribedRef = useRef<string | null>(null);

  // Use shallow comparison to avoid re-render loops from new {} references.
  // Filter out stopped sessions — they should not appear in the status bar.
  const sessionEntries = useLspStore(
    useShallow((s) => {
      if (!activeProjectPath) return [] as LspSessionState[];
      const projectSessions = s.sessions[activeProjectPath];
      if (!projectSessions) return [] as LspSessionState[];
      return Object.values(projectSessions).filter((se) => se.status !== 'stopped');
    }),
  );

  const projectProfile = useLspStore((s) =>
    activeProjectPath ? (s.profiles[activeProjectPath] ?? null) : null,
  );
  const extensionConflicts = useLspStore((s) => s.extensionConflicts);

  // Subscribe to LSP session events + load initial state + soft-warm profile
  useEffect(() => {
    if (!activeProjectPath || subscribedRef.current === activeProjectPath) return;
    subscribedRef.current = activeProjectPath;

    const store = useLspStore.getState();
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    // Subscribe first, then poll — ensures events aren't lost between sub and poll
    store.subscribeToProject(activeProjectPath).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenFn = unlisten;
      // Now event listener is ready; fetch sessions already running
      lspListSessions().then((sessions) => {
        if (cancelled) return;
        for (const s of sessions) {
          if (s.project_path === activeProjectPath) {
            store.setSessionState(activeProjectPath, s.language_id, {
              serverName: s.server_name,
              status: s.status as LspSessionState['status'],
              statusMessage: s.status_message,
              progressPct: s.progress_pct,
            });
          }
        }
      });
    });

    // Detect profile + soft-warm primary (no server spawn)
    void store.onProjectActivated(activeProjectPath);

    return () => {
      cancelled = true;
      subscribedRef.current = null;
      unlistenFn?.();
    };
  }, [activeProjectPath]);

  // Listen for auto-install progress events
  useEffect(() => {
    const unlistenP = listen<LspInstallProgressEvent>('lsp-install-progress', (event) => {
      const { language_id, phase, message } = event.payload;
      if (phase === 'done' || phase === 'error') {
        setTimeout(() => setInstallProgress(null), phase === 'done' ? 2000 : 5000);
      }
      setInstallProgress({ language_id, phase, message });
    });
    return () => {
      unlistenP.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (dropdownOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        minWidth: 200,
      });
    } else {
      setDropdownStyle(undefined);
    }
  }, [dropdownOpen]);

  const handleRestart = async (languageId: string) => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    const name = sessionEntries.find((s) => s.languageId === languageId)?.serverName;
    setDropdownOpen(false);
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
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'LSP Restart Failed',
        message: String(e),
      });
    }
  };

  const handleStop = async (languageId: string) => {
    if (!activeProjectPath) return;
    const store = useLspStore.getState();
    setDropdownOpen(false);
    store.removeSession(activeProjectPath, languageId);
    try {
      await lspStopSession(activeProjectPath, languageId);
    } catch (e) {
      console.error('[LSP] Stop failed:', e);
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'LSP Stop Failed',
        message: String(e),
      });
    }
  };

  const leftContent = () => {
    if (installProgress) {
      const { phase, language_id, message } = installProgress;
      const fromProfile = projectProfile?.candidates?.find((c) => c.languageId === language_id);
      const label = serverName(language_id, fromProfile?.serverName);
      if (phase === 'installing') {
        return (
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="lsp-spinner" />
            <span>
              Installing {label}
              <span className="lsp-dot">.</span>
              <span className="lsp-dot">.</span>
              <span className="lsp-dot">.</span>
            </span>
          </span>
        );
      }
      if (phase === 'done') {
        return <span className="text-status-idle">{label} installed</span>;
      }
      return (
        <span className="text-text-muted" title={message}>
          {label} install failed
        </span>
      );
    }

    if (sessionEntries.length > 0) {
      return (
        <div className="relative" ref={dropdownRef}>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex h-4 items-center gap-1.5 leading-4 hover:text-text-primary transition-colors"
            title="Click to manage LSP servers"
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                sessionEntries.some((s) => s.status === 'error')
                  ? 'bg-status-error'
                  : sessionEntries.some((s) => s.status === 'indexing' || s.status === 'starting')
                    ? 'bg-status-running animate-pulse'
                    : 'bg-status-idle',
              )}
            />
            <span className="truncate">
              {sessionEntries.length > 1
                ? `${sessionEntries.length} LSPs`
                : serverName(sessionEntries[0].languageId, sessionEntries[0].serverName)}
            </span>
          </button>
          {dropdownOpen &&
            dropdownStyle &&
            createPortal(
              <div
                className="bg-popover border border-border rounded-md shadow-lg py-1 z-50"
                data-lsp-dropdown
                style={dropdownStyle}
              >
                {sessionEntries.map((session) => (
                  <div
                    key={session.languageId}
                    className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-hover"
                    title={`${session.status}${session.statusMessage ? `: ${session.statusMessage}` : ''}${session.progressPct != null ? ` (${session.progressPct}%)` : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          session.status === 'ready'
                            ? 'bg-status-idle'
                            : session.status === 'error'
                              ? 'bg-status-error'
                              : session.status === 'stopped'
                                ? 'bg-text-muted'
                                : 'bg-status-running animate-pulse',
                        )}
                      />
                      <span>{serverName(session.languageId, session.serverName)}</span>
                      {session.progressPct != null && (
                        <span className="text-text-muted">{session.progressPct}%</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestart(session.languageId);
                        }}
                        className="text-text-muted hover:text-text-primary px-1"
                        title="Restart"
                      >
                        ↻
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStop(session.languageId);
                        }}
                        className="text-text-muted hover:text-status-error px-1"
                        title="Stop"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>,
              document.body,
            )}
        </div>
      );
    }

    // Profile detected but no server running yet (autoStart=onFirstFile)
    if (projectProfile?.primary) {
      const p = projectProfile.primary;
      const label = serverName(p.languageId, p.serverName);
      const markers = p.markers.length > 0 ? p.markers.join(', ') : 'project override';
      return (
        <span
          className="flex items-center gap-1.5 text-text-muted"
          title={`${p.languageId} (${markers}). Open a matching file to start ${label}.`}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-muted" />
          <span className="truncate">
            {label} · detected
          </span>
        </span>
      );
    }

    return null;
  };

  const conflictTitle =
    extensionConflicts.length > 0
      ? extensionConflicts
          .map(
            (c) =>
              `*.${c.extension}: ${c.winnerLanguageId} wins over ${c.displacedLanguageIds.join(', ')}`,
          )
          .join('\n')
      : undefined;

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !(target as Element).closest?.('[data-lsp-dropdown]')
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  return (
    <div className="flex h-4 items-center justify-between px-3 text-xs leading-4 text-text-secondary shrink-0 select-none">
      <div className="flex h-full min-w-0 items-center gap-3">
        {leftContent()}
        {extensionConflicts.length > 0 ? (
          <span
            className="flex items-center gap-1 text-status-running truncate max-w-[220px]"
            title={conflictTitle}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-status-running" />
            <span className="truncate">
              {extensionConflicts.length === 1
                ? `*.${extensionConflicts[0].extension} conflict`
                : `${extensionConflicts.length} ext conflicts`}
            </span>
          </span>
        ) : null}
      </div>
      <div className="flex h-full shrink-0 items-center gap-3">
        {activeProjectId ? (
          <button
            type="button"
            className={cn(
              'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
              consolePanelOpen ? 'text-text-primary' : '',
            )}
            title={
              runningConsoleCount > 0
                ? `Console · ${activeConsole?.name ?? 'running'}`
                : consolePanelOpen
                  ? 'Hide task console'
                  : 'Show task console'
            }
            onClick={() => toggleConsolePanel()}
          >
            <span className="relative inline-flex">
              <Terminal size={12} className="shrink-0" />
              {runningConsoleCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              ) : activeConsole?.status === 'failed' ? (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-red" />
              ) : null}
            </span>
            <span>Console</span>
          </button>
        ) : null}
        {activeProjectId ? (
          <button
            type="button"
            className={cn(
              'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
              debugPanelOpen ? 'text-text-primary' : '',
            )}
            title={
              debugSession
                ? `Debug · ${debugSession.status}${debugSession.configName ? ` · ${debugSession.configName}` : ''}`
                : debugPanelOpen
                  ? 'Hide debug panel'
                  : 'Show debug panel'
            }
            onClick={() => toggleDebugPanel()}
          >
            <span className="relative inline-flex">
              <Bug size={12} className="shrink-0" />
              {debugSession ? (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full',
                    debugSession.status === 'stopped'
                      ? 'bg-accent-yellow'
                      : debugSession.status === 'running' ||
                          debugSession.status === 'starting'
                        ? 'bg-accent-green animate-pulse'
                        : 'bg-text-muted',
                  )}
                />
              ) : null}
            </span>
            <span>Debug</span>
          </button>
        ) : null}
        {cursorPosition && (
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.col}
          </span>
        )}
        <NotificationButton />
      </div>
    </div>
  );
}
