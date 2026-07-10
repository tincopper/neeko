import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface LspSessionState {
  languageId: string;
  serverName: string;
  status: 'starting' | 'initializing' | 'indexing' | 'ready' | 'error' | 'stopped';
  statusMessage?: string;
  progressPct?: number;
}

interface LspSessionStatusEventPayload {
  languageId: string;
  status: string;
  message?: string;
  progressPct?: number;
}

interface LspStoreState {
  /** Sessions per project path: projectPath → session map keyed by languageId */
  sessions: Record<string, Record<string, LspSessionState>>;
  setSessionState: (projectPath: string, languageId: string, state: Partial<LspSessionState>) => void;
  removeSession: (projectPath: string, languageId: string) => void;
  /** Subscribe to LSP session events for a project. Returns unsubscribe function. */
  subscribeToProject: (projectPath: string) => Promise<UnlistenFn>;
  /** Get sessions for the active project, or empty record */
  getProjectSessions: (projectPath: string | null) => Record<string, LspSessionState>;
}

export const useLspStore = create<LspStoreState>((set, get) => ({
  sessions: {},

  setSessionState: (projectPath, languageId, state) => {
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [projectPath]: {
          ...(prev.sessions[projectPath] ?? {}),
          [languageId]: {
            languageId,
            serverName: state.serverName ?? prev.sessions[projectPath]?.[languageId]?.serverName ?? '',
            status: (state.status as LspSessionState['status']) ?? prev.sessions[projectPath]?.[languageId]?.status ?? 'starting',
            statusMessage: state.statusMessage,
            progressPct: state.progressPct,
          },
        },
      },
    }));
  },

  removeSession: (projectPath, languageId) => {
    set((prev) => {
      const projectSessions = prev.sessions[projectPath];
      if (!projectSessions) return prev;
      const next = { ...projectSessions };
      delete next[languageId];
      return {
        sessions: {
          ...prev.sessions,
          [projectPath]: next,
        },
      };
    });
  },

  subscribeToProject: async (projectPath) => {
    const eventName = `lsp-session-${projectPath}`;
    const unlisten = await listen<LspSessionStatusEventPayload>(eventName, (event) => {
      const { languageId, status, message, progressPct } = event.payload;
      const store = get();
      store.setSessionState(projectPath, languageId, {
        status: status as LspSessionState['status'],
        statusMessage: message,
        progressPct,
      });
    });
    return unlisten;
  },

  getProjectSessions: (projectPath) => {
    if (!projectPath) return {};
    return get().sessions[projectPath] ?? {};
  },
}));
