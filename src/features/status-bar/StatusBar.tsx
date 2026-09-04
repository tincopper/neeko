import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import { useDebugStore } from '@/features/debug/store/debugStore';
import { BranchStatusBarWidget } from '@/features/git';
import { lspListSessions } from '@/features/lsp/api/lspApi';
import { NotificationButton } from '@/features/notification';
import { useActiveProject } from '@/features/project';
import { cn } from '@/lib/utils';
import { Bug, Terminal } from '@/shared/components/icons';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLspStore, type LspSessionState } from '@/shared/store/lspStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useTaskStore } from '@/shared/store/taskStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { LspStatusSection, serverName } from './LspStatusSection';
import { PromptsStatusSection } from './PromptsStatusSection';

interface LspInstallProgressEvent {
  language_id: string;
  phase: 'installing' | 'done' | 'error';
  message: string;
}

export function StatusBar() {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const activeProjectName = useProjectStore((s) => s.activeProject?.name ?? 'Project');
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
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      const fn = await listen<LspInstallProgressEvent>('lsp-install-progress', (event) => {
        if (cancelled) return;
        const { language_id, phase, message } = event.payload;
        if (phase === 'done' || phase === 'error') {
          setTimeout(() => setInstallProgress(null), phase === 'done' ? 2000 : 5000);
        }
        setInstallProgress({ language_id, phase, message });
      });
      if (!cancelled) {
        unlisten = safeUnlisten(fn);
      }
    };

    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
        return <span className="text-status-idle">{label}</span>;
      }
      return (
        <span className="text-text-muted" title={message}>
          {label} install failed
        </span>
      );
    }

    if (sessionEntries.length > 0 && activeProjectPath) {
      return (
        <LspStatusSection
          activeProjectPath={activeProjectPath}
          activeProjectId={activeProjectId}
          projectName={activeProjectName}
          sessionEntries={sessionEntries}
        />
      );
    }

    // Profile detected but no server running yet (autoStart=onFirstFile) — non-interactive in v1
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
          <span className="truncate">{label}</span>
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

  const { commands } = useActiveProject();

  const handleStatusBarCheckout = useCallback(
    async (branchName: string) => {
      try {
        await commands?.checkoutBranch(branchName);
        // Refresh git info after checkout
        if (activeProjectId) {
          await commands?.refreshGitInfo();
        }
      } catch (e) {
        console.error('[StatusBar] Checkout failed:', e);
      }
    },
    [commands, activeProjectId],
  );

  return (
    <div className="flex h-4 items-center justify-between px-3 text-xs leading-4 text-text-secondary shrink-0 select-none">
      <div className="flex h-full min-w-0 items-center gap-3">
        {activeProjectId && (
          <BranchStatusBarWidget
            onNewBranch={() => {}}
            onNewWorktree={() => {}}
            onCheckoutBranch={handleStatusBarCheckout}
          />
        )}
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
                      : debugSession.status === 'running' || debugSession.status === 'starting'
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
        <PromptsStatusSection />
        <NotificationButton />
      </div>
    </div>
  );
}
