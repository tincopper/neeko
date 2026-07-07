import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { lspListSessions } from '../api/lspApi';
import type { LspSessionInfo } from '../types';

interface LspStatusBarProps {
  projectPath: string | null;
  languageId: string | null;
}

interface SessionState {
  connected: boolean;
  serverName: string;
  progressMessage: string | null;
  progressPercentage: number | null;
}

/**
 * Displays LSP connection status and work-done progress in the status bar.
 *
 * States:
 * - ◌  Gray dot  = No LSP server for this language
 * - ⬤  Green dot = Connected and ready
 * - ◐  Yellow    = Indexing / loading (with percentage)
 * - ✕  Red x     = Connection failed
 */
export function LspStatusBar({ projectPath, languageId }: LspStatusBarProps) {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    if (!projectPath || !languageId) {
      setState(null);
      return;
    }

    let cancelled = false;

    // Poll session list to detect connection status
    const checkSession = async () => {
      try {
        const sessions: LspSessionInfo[] = await lspListSessions();
        const session = sessions.find(
          (s) => s.project_path === projectPath && s.language_id === languageId,
        );
        if (!cancelled) {
          setState((prev) => ({
            connected: session?.connected ?? false,
            serverName: session?.server_name ?? languageId,
            progressMessage: prev?.progressMessage ?? null,
            progressPercentage: prev?.progressPercentage ?? null,
          }));
        }
      } catch {
        // Ignore — status bar is best-effort
      }
    };

    checkSession();
    const interval = setInterval(checkSession, 3000);

    // Listen for work-done progress events
    const progressEventName = `lsp-progress-${projectPath}`;
    const unlistenPromise = listen<{
      languageId: string;
      kind: string;
      message: string | null;
      percentage: number | null;
    }>(progressEventName, (event) => {
      if (event.payload.languageId !== languageId) return;

      if (event.payload.kind === 'end') {
        setState((prev) =>
          prev
            ? { ...prev, progressMessage: null, progressPercentage: null }
            : null,
        );
      } else {
        setState((prev) => ({
          connected: prev?.connected ?? true,
          serverName: prev?.serverName ?? languageId,
          progressMessage: event.payload.message,
          progressPercentage: event.payload.percentage,
        }));
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unlistenPromise.then((u) => u());
    };
  }, [projectPath, languageId]);

  if (!state) return null;

  const { connected, serverName, progressMessage, progressPercentage } = state;

  // Determine status indicator
  let indicator: string;
  let color: string;
  let title: string;

  if (progressMessage) {
    indicator = '◐';
    color = '#eab308'; // yellow
    title = `${serverName}: ${progressMessage}${progressPercentage != null ? ` (${progressPercentage}%)` : ''}`;
  } else if (connected) {
    indicator = '⬤';
    color = '#22c55e'; // green
    title = `${serverName} (connected)`;
  } else {
    indicator = '✕';
    color = '#ef4444'; // red
    title = `${serverName} (disconnected)`;
  }

  return (
    <span
      className="text-xs flex items-center gap-1 select-none"
      title={title}
    >
      <span style={{ color, fontSize: '10px' }}>{indicator}</span>
      <span className="text-text-secondary">
        {serverName}
        {progressMessage && (
          <span className="ml-1 text-text-tertiary">
            {progressMessage}
            {progressPercentage != null && ` ${progressPercentage}%`}
          </span>
        )}
      </span>
    </span>
  );
}
