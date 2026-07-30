import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import {
  lspGetServerInfo,
  lspRestartAllSessions,
  lspRestartSession,
  lspStopAllSessions,
  lspStopSession,
  type LspServerInfo,
} from '@/features/lsp/api/lspApi';
import { RefreshCw, ServerIcon, Square, TerminalIcon } from '@/shared/components/icons';
import { useLspStore, type LspSessionState } from '@/shared/store/lspStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useTaskStore } from '@/shared/store/taskStore';
import { cn } from '@/shared/utils/cn';

/**
 * Enter/exit presence: mounts the element, animates opacity+transform, and only
 * unmounts after the exit transition finishes. Returns the inline style that
 * drives the animation plus an onTransitionEnd handler.
 */
function usePresence(visible: boolean, onExited?: () => void) {
  const [mounted, setMounted] = useState(visible);
  const [show, setShow] = useState(visible);
  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useEffect(() => {
    if (visible) {
      // Sync mount + next-frame show: the element must be in the DOM before
      // toggling the transform/opacity so the enter transition plays.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      const id = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(id);
    }
    setShow(false);
    return undefined;
  }, [visible]);

  const onTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false);
      onExitedRef.current?.();
    }
  }, [visible]);

  return { mounted, show, onTransitionEnd };
}

/** Returns true one frame after mount — used to delay position transitions. */
function useOnlyAfterMount() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/** Respects the user's reduced-motion preference. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const ENTER_DUR = 120;
const EXIT_DUR = 80;

const BUILTIN_SERVER_NAMES: Record<string, string> = {
  rust: 'rust-analyzer',
  python: 'pyright',
  typescript: 'typescript-language-server',
  javascript: 'typescript-language-server',
  go: 'gopls',
  java: 'jdtls',
  cpp: 'clangd',
  csharp: 'omnisharp',
};

/** Prefer live session/profile server name so custom LSPs display correctly. */
export function serverName(languageId: string, liveName?: string | null): string {
  if (liveName && liveName.trim()) return liveName;
  return BUILTIN_SERVER_NAMES[languageId] ?? languageId;
}

function statusDotClass(
  status:
    | LspSessionState['status']
    | 'aggregate-error'
    | 'aggregate-busy'
    | 'aggregate-ready'
    | 'muted',
): string {
  switch (status) {
    case 'ready':
    case 'aggregate-ready':
      return 'bg-status-idle';
    case 'error':
    case 'aggregate-error':
      return 'bg-status-failed';
    case 'stopped':
    case 'muted':
      return 'bg-text-muted';
    default:
      // starting | initializing | indexing | aggregate-busy
      return 'bg-status-running animate-pulse';
  }
}

function aggregateStatus(
  sessions: LspSessionState[],
): 'aggregate-error' | 'aggregate-busy' | 'aggregate-ready' {
  if (sessions.some((s) => s.status === 'error')) return 'aggregate-error';
  if (
    sessions.some(
      (s) => s.status === 'indexing' || s.status === 'starting' || s.status === 'initializing',
    )
  ) {
    return 'aggregate-busy';
  }
  return 'aggregate-ready';
}

function humanStatus(status: LspSessionState['status']): string {
  switch (status) {
    case 'ready':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'initializing':
      return 'Initializing';
    case 'indexing':
      return 'Indexing';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return status;
  }
}

function formatMemoryMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '—';
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function formatInfoFooter(status: LspSessionState['status'], info: LspServerInfo | null): string {
  const statusLabel = humanStatus(status);
  if (!info) return statusLabel;
  const version = info.version ? `v${info.version}` : 'v?';
  const metaParts: string[] = [];
  if (info.commit) metaParts.push(info.commit);
  if (info.buildDate) metaParts.push(info.buildDate);
  const meta = metaParts.length > 0 ? ` (${metaParts.join(' ')})` : '';
  const mem = formatMemoryMb(info.memoryMb);
  return `${statusLabel} — ${version}${meta} — ${mem}`;
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={cn(
        'w-2.5 h-2.5 shrink-0 text-text-muted transition-transform duration-200',
        open ? 'rotate-180' : 'rotate-0',
      )}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      className="w-2.5 h-2.5 shrink-0 text-text-muted"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M4.5 3L7.5 6L4.5 9" />
    </svg>
  );
}

export interface LspStatusSectionProps {
  activeProjectPath: string;
  activeProjectId: string | null;
  projectName: string;
  sessionEntries: LspSessionState[];
}

/**
 * Status-bar LSP chip + nested menus (main list + per-server submenu).
 */
export function LspStatusSection({
  activeProjectPath,
  activeProjectId,
  projectName,
  sessionEntries,
}: LspStatusSectionProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | undefined>(undefined);
  const [activeSubmenuLanguageId, setActiveSubmenuLanguageId] = useState<string | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [submenuInfo, setSubmenuInfo] = useState<LspServerInfo | null>(null);
  const [submenuInfoLoading, setSubmenuInfoLoading] = useState(false);
  const [infoForLanguageId, setInfoForLanguageId] = useState<string | null>(null);

  // Render-time reset when the active submenu server changes. This is the
  // React-recommended way to reset derived state on dependency change, keeping
  // the fetch effect free of synchronous setState calls.
  if (activeSubmenuLanguageId !== infoForLanguageId) {
    setInfoForLanguageId(activeSubmenuLanguageId);
    setSubmenuInfo(null);
    setSubmenuInfoLoading(!!activeSubmenuLanguageId);
  }

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimerRef = useRef<number | null>(null);

  const openLspLogConsole = useTaskStore((s) => s.openLspLogConsole);
  const reducedMotion = useReducedMotion();

  // Main dropdown presence (enter/exit animation).
  const dropdownPresence = usePresence(dropdownOpen);
  // Submenu presence (enter/exit animation).
  const submenuPresence = usePresence(dropdownOpen && !!activeSubmenuLanguageId, () => {
    setActiveSubmenuLanguageId(null);
    setSubmenuInfo(null);
  });
  // Gate position transitions to after-mount so the submenu doesn't animate
  // into place on first open.
  const submenuPositionReady = useOnlyAfterMount();

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const closeAll = useCallback(() => {
    clearCloseTimer();
    setDropdownOpen(false);
    setActiveSubmenuLanguageId(null);
    setSubmenuInfo(null);
    setSubmenuStyle(undefined);
  }, []);

  // Position main dropdown from chip button.
  useEffect(() => {
    if (dropdownOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        minWidth: 220,
      });
    } else {
      setDropdownStyle(undefined);
    }
  }, [dropdownOpen]);

  // Position submenu from active server row.
  // The submenu portal is gated by `activeSession`, so a stale style when no
  // submenu is active is harmless — no render-time reset needed here.
  useEffect(() => {
    if (!activeSubmenuLanguageId) {
      return;
    }
    const el = rowRefs.current[activeSubmenuLanguageId];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Auto-width: let content breathe between 260–360px.
    const minWidth = 260;
    const maxWidth = 360;
    const preferRight = rect.right + 4;
    const left =
      preferRight + minWidth > window.innerWidth
        ? Math.max(8, rect.left - minWidth - 4)
        : preferRight;
    setSubmenuStyle({
      position: 'fixed',
      top: Math.max(8, rect.top),
      left,
      minWidth,
      maxWidth,
    });
  }, [activeSubmenuLanguageId, dropdownOpen]);

  // Fetch server info when submenu opens. State resets happen at render time
  // above; this effect only updates state inside async callbacks.
  useEffect(() => {
    if (!activeSubmenuLanguageId || !activeProjectPath) {
      return;
    }
    let cancelled = false;
    void lspGetServerInfo(activeProjectPath, activeSubmenuLanguageId)
      .then((info) => {
        if (!cancelled) setSubmenuInfo(info);
      })
      .catch((e) => {
        console.warn('[LSP] get_server_info failed:', e);
        if (!cancelled) setSubmenuInfo(null);
      })
      .finally(() => {
        if (!cancelled) setSubmenuInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSubmenuLanguageId, activeProjectPath]);

  // Outside click closes both menus.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        (target as Element).closest?.('[data-lsp-dropdown]') ||
        (target as Element).closest?.('[data-lsp-submenu]')
      ) {
        return;
      }
      closeAll();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, closeAll]);

  // Escape closes menus.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dropdownOpen, closeAll]);

  const notifyError = (title: string, e: unknown) => {
    useNotificationStore.getState().addNotification({
      type: 'error',
      title,
      message: String(e),
    });
  };

  const handleRestart = async (languageId: string) => {
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
    if (!activeProjectId) return;
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

  const openSubmenu = (languageId: string) => {
    clearCloseTimer();
    setActiveSubmenuLanguageId(languageId);
  };

  const scheduleCloseSubmenu = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setActiveSubmenuLanguageId(null);
      setSubmenuInfo(null);
    }, 180);
  };

  if (sessionEntries.length === 0) return null;

  const multi = sessionEntries.length > 1;
  const chipTitle = multi
    ? `${sessionEntries.length} LSPs`
    : serverName(sessionEntries[0].languageId, sessionEntries[0].serverName);
  const agg = aggregateStatus(sessionEntries);
  const activeSession = activeSubmenuLanguageId
    ? (sessionEntries.find((s) => s.languageId === activeSubmenuLanguageId) ?? null)
    : null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (dropdownOpen) closeAll();
          else setDropdownOpen(true);
        }}
        className="flex h-4 items-center gap-1.5 leading-4 hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded-sm"
        title={multi ? chipTitle : 'Click to manage LSP servers'}
        data-testid="lsp-status-chip"
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200',
            statusDotClass(agg),
          )}
        />
        {multi ? (
          <ServerIcon size={12} className="shrink-0" aria-hidden />
        ) : (
          <span className="truncate">
            {serverName(sessionEntries[0].languageId, sessionEntries[0].serverName)}
          </span>
        )}
        <ChevronDown open={dropdownOpen} />
      </button>

      {dropdownPresence.mounted &&
        dropdownStyle &&
        createPortal(
          <div
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 text-xs text-text-primary"
            data-lsp-dropdown
            data-testid="lsp-status-dropdown"
            style={{
              ...dropdownStyle,
              opacity: dropdownPresence.show ? 1 : 0,
              transform: dropdownPresence.show
                ? 'translateY(0) scale(1)'
                : 'translateY(-4px) scale(0.96)',
              transition: reducedMotion
                ? 'opacity 80ms linear'
                : dropdownPresence.show
                  ? `opacity ${ENTER_DUR}ms ${EASE_OUT}, transform ${ENTER_DUR}ms ${EASE_OUT}`
                  : `opacity ${EXIT_DUR}ms ${EASE_IN}, transform ${EXIT_DUR}ms ${EASE_IN}`,
            }}
            onTransitionEnd={dropdownPresence.onTransitionEnd}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div className="text-text-muted px-3 py-1 text-[11px] truncate" title={projectName}>
              {projectName || 'Project'}
            </div>
            <div className="border-t border-border my-0.5" />

            {sessionEntries.map((session) => {
              const label = serverName(session.languageId, session.serverName);
              const isActive = activeSubmenuLanguageId === session.languageId;
              return (
                <button
                  key={session.languageId}
                  ref={(el) => {
                    rowRefs.current[session.languageId] = el;
                  }}
                  type="button"
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm cursor-pointer text-left transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue',
                    isActive && 'bg-bg-hover',
                  )}
                  title={`${session.status}${session.statusMessage ? `: ${session.statusMessage}` : ''}${session.progressPct != null ? ` (${session.progressPct}%)` : ''}`}
                  onMouseEnter={() => openSubmenu(session.languageId)}
                  onFocus={() => openSubmenu(session.languageId)}
                  onClick={() => openSubmenu(session.languageId)}
                  data-testid={`lsp-server-row-${session.languageId}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        statusDotClass(session.status),
                      )}
                    />
                    <span className="truncate">{label}</span>
                    {session.progressPct != null && (
                      <span className="text-text-muted shrink-0">{session.progressPct}%</span>
                    )}
                  </span>
                  <ChevronRight />
                </button>
              );
            })}

            <div className="border-t border-border my-0.5" />
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleRestartAll()}
              data-testid="lsp-restart-all"
            >
              <RefreshCw size={12} className="shrink-0 text-text-muted" />
              Restart All Servers
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleStopAll()}
              data-testid="lsp-stop-all"
            >
              <Square size={12} className="shrink-0 text-text-muted" />
              Stop All Servers
            </button>
          </div>,
          document.body,
        )}

      {submenuPresence.mounted &&
        activeSession &&
        submenuStyle &&
        createPortal(
          <div
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 text-xs text-text-primary"
            data-lsp-submenu
            data-testid="lsp-server-submenu"
            style={{
              ...submenuStyle,
              opacity: submenuPresence.show ? 1 : 0,
              transform: submenuPresence.show
                ? 'translateX(0) scale(1)'
                : 'translateX(-4px) scale(0.96)',
              transition: reducedMotion
                ? 'opacity 80ms linear'
                : submenuPresence.show
                  ? `opacity ${ENTER_DUR}ms ${EASE_OUT}, transform ${ENTER_DUR}ms ${EASE_OUT}`
                  : `opacity ${EXIT_DUR}ms ${EASE_IN}, transform ${EXIT_DUR}ms ${EASE_IN}${
                      submenuPositionReady ? `, left 150ms ${EASE_OUT}, top 150ms ${EASE_OUT}` : ''
                    }`,
            }}
            onTransitionEnd={submenuPresence.onTransitionEnd}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleViewLogs(activeSession)}
              data-testid="lsp-view-logs"
            >
              <TerminalIcon size={12} className="shrink-0 text-text-muted" />
              View Logs
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleRestart(activeSession.languageId)}
              data-testid="lsp-restart-server"
            >
              <RefreshCw size={12} className="shrink-0 text-text-muted" />
              Restart Server
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleStop(activeSession.languageId)}
              data-testid="lsp-stop-server"
            >
              <Square size={12} className="shrink-0 text-text-muted" />
              Stop Server
            </button>
            <div className="border-t border-border mt-0.5" />
            <div
              className="px-3 py-1.5 text-text-muted text-[11px] flex items-center gap-1.5"
              data-testid="lsp-server-info-footer"
              title={
                submenuInfoLoading
                  ? 'Loading…'
                  : formatInfoFooter(activeSession.status, submenuInfo)
              }
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200',
                  statusDotClass(activeSession.status),
                )}
              />
              <span
                className="whitespace-nowrap transition-opacity duration-150"
                style={{ opacity: submenuInfoLoading ? 0.5 : 1 }}
              >
                {submenuInfoLoading
                  ? `${humanStatus(activeSession.status)} — …`
                  : formatInfoFooter(activeSession.status, submenuInfo)}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default LspStatusSection;
