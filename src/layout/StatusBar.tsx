import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

import { lspListSessions } from '@/features/lsp/api/lspApi';
import type { LspSessionInfo } from '@/features/lsp/types';
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

/**
 * Global bottom status bar — always visible at the window's bottom edge.
 *
 * - Left side: LSP connection status dots + server names.
 * - Right side: Cursor line:col position when a file is open.
 *
 * Polls `lspListSessions()` every 5 s and subscribes to `useEditorStore.cursorPosition`.
 */
interface LspInstallProgressEvent {
  language_id: string;
  phase: 'installing' | 'done' | 'error';
  message: string;
}

export function StatusBar() {
  const [sessions, setSessions] = useState<LspSessionInfo[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [installProgress, setInstallProgress] = useState<LspInstallProgressEvent | null>(null);
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);

  // Self-contained LSP polling (5 s interval)
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const result = await lspListSessions();
        setSessions(result);
        setFetchError(false);
      } catch {
        setFetchError(true);
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for auto-install progress events
  useEffect(() => {
    const unlistenPromise = listen<LspInstallProgressEvent>('lsp-install-progress', (event) => {
      const { language_id, phase, message } = event.payload;
      if (phase === 'done' || phase === 'error') {
        setTimeout(() => setInstallProgress(null), phase === 'done' ? 2000 : 5000);
      }
      setInstallProgress({ language_id, phase, message });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Filter sessions that belong to the active project
  const projectSessions = activeProjectPath
    ? sessions.filter((s) => s.project_path === activeProjectPath)
    : [];

  // Has the user opened a file? (cursorPosition is set by CodeMirror only when a file is active)
  const fileIsOpen = !!cursorPosition;

  const leftContent = () => {
    // Show install progress if active
    if (installProgress) {
      const { phase, language_id, message } = installProgress;
      const serverLabel = serverName(language_id);
      if (phase === 'installing') {
        return (
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="lsp-spinner" />
            <span>
              Installing {serverLabel}
              <span className="lsp-dot">.</span>
              <span className="lsp-dot">.</span>
              <span className="lsp-dot">.</span>
            </span>
          </span>
        );
      }
      if (phase === 'done') {
        return <span className="text-status-idle">{serverLabel} installed</span>;
      }
      // error
      return (
        <span className="text-text-muted" title={message}>
          {serverLabel} install failed
        </span>
      );
    }

    if (fetchError) {
      return <span className="text-text-muted">LSP error</span>;
    }

    if (projectSessions.length > 0) {
      return projectSessions.map((session) => (
        <span
          key={session.language_id}
          className="flex items-center gap-1.5 shrink-0"
          title={`${session.language_id}: ${session.connected ? 'Connected' : 'Connecting'}`}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              session.connected ? 'bg-status-idle' : 'bg-status-running animate-pulse',
            )}
          />
          <span className="truncate">{serverName(session.language_id)}</span>
        </span>
      ));
    }

    if (fileIsOpen) {
      return (
        <span className="text-text-muted" title="Install the language server (e.g. rust-analyzer, typescript-language-server) to enable LSP features">
          LSP unavailable
        </span>
      );
    }

    // No file open
    return <span className="text-text-muted">No LSP servers</span>;
  };

  return (
    <div className="flex items-center justify-between h-6 px-3 text-xs text-text-secondary shrink-0 select-none">
      {/* Left: LSP connection status */}
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        {leftContent()}
      </div>

      {/* Right: cursor position */}
      <div className="flex items-center gap-2 shrink-0">
        {cursorPosition && (
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.col}
          </span>
        )}
      </div>
    </div>
  );
}
