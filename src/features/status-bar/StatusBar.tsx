import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { lspListSessions, lspRestartSession, lspStopSession } from '@/features/lsp/api/lspApi';
import { useLspStore, type LspSessionState } from '@/features/lsp/store/lspStore';
import { NotificationButton } from '@/features/notification/components/NotificationButton';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { useProjectStore } from '@/features/project/store';
import { useEditorStore } from '@/shared/store';
import { cn } from '@/shared/utils/cn';

function serverName(languageId: string): string {
  const names: Record<string, string> = {
    rust: 'rust-analyzer',
    python: 'pyright',
    typescript: 'ts-server',
    javascript: 'ts-server',
    go: 'gopls',
    java: 'jdtls',
    cpp: 'clangd',
    csharp: 'omnisharp',
  };
  return names[languageId] ?? languageId;
}

interface LspInstallProgressEvent {
  language_id: string;
  phase: 'installing' | 'done' | 'error';
  message: string;
}

export function StatusBar() {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
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

  // Subscribe to LSP session events + load initial state
  useEffect(() => {
    if (!activeProjectPath || subscribedRef.current === activeProjectPath) return;
    subscribedRef.current = activeProjectPath;

    const store = useLspStore.getState();
    let cancelled = false;

    // Subscribe first, then poll — ensures events aren't lost between sub and poll
    store.subscribeToProject(activeProjectPath).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
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

    return () => {
      cancelled = true;
      subscribedRef.current = null;
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
      const label = serverName(language_id);
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
                : serverName(sessionEntries[0].languageId)}
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
                      <span>{serverName(session.languageId)}</span>
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

    return null;
  };

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
      <div className="flex h-full min-w-0 items-center gap-3">{leftContent()}</div>
      <div className="flex h-full shrink-0 items-center gap-3">
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
