import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

import { lspCheckServerInstalled, lspDetectProjectProfile } from '../api/lspApi';
import type { ProjectLanguageProfile } from '../types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';

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

/** Map languageId → representative file for CodeMirror lang preload. */
const LANG_PRELOAD_FILE: Record<string, string> = {
  go: 'main.go',
  rust: 'main.rs',
  typescript: 'index.ts',
  typescriptreact: 'App.tsx',
  javascript: 'index.js',
  javascriptreact: 'App.jsx',
  python: 'main.py',
  java: 'Main.java',
  cpp: 'main.cpp',
  c: 'main.c',
};

interface LspStoreState {
  sessions: Record<string, Record<string, LspSessionState>>;
  /** Detected profile per project path (marker scan, may have no running session). */
  profiles: Record<string, ProjectLanguageProfile>;
  setSessionState: (projectPath: string, languageId: string, state: Partial<LspSessionState>) => void;
  removeSession: (projectPath: string, languageId: string) => void;
  setProfile: (profile: ProjectLanguageProfile) => void;
  subscribeToProject: (projectPath: string) => Promise<UnlistenFn>;
  getProjectSessions: (projectPath: string | null) => Record<string, LspSessionState>;
  /**
   * On project activation: detect profile, soft-warm primary language
   * (binary check + codemirror preload). Does not spawn servers.
   */
  onProjectActivated: (projectPath: string) => Promise<void>;
}

export const useLspStore = create<LspStoreState>((set, get) => ({
  sessions: {},
  profiles: {},

  setSessionState: (projectPath, languageId, state) => {
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [projectPath]: {
          ...(prev.sessions[projectPath] ?? {}),
          [languageId]: {
            languageId,
            serverName:
              state.serverName ??
              prev.sessions[projectPath]?.[languageId]?.serverName ??
              '',
            status:
              (state.status as LspSessionState['status']) ??
              prev.sessions[projectPath]?.[languageId]?.status ??
              'starting',
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

  setProfile: (profile) => {
    set((prev) => ({
      profiles: {
        ...prev.profiles,
        [profile.projectPath]: profile,
      },
    }));
  },

  subscribeToProject: async (projectPath) => {
    const eventName = `lsp-session-${projectPath}`;
    const unlistenSession = await listen<LspSessionStatusEventPayload>(eventName, (event) => {
      const { languageId, status, message, progressPct } = event.payload;
      const store = get();
      store.setSessionState(projectPath, languageId, {
        status: status as LspSessionState['status'],
        statusMessage: message,
        progressPct,
      });
    });

    const unlistenProfile = await listen<ProjectLanguageProfile>('lsp-project-profile', (event) => {
      if (event.payload.projectPath === projectPath) {
        get().setProfile(event.payload);
      }
    });

    return () => {
      unlistenSession();
      unlistenProfile();
    };
  },

  getProjectSessions: (projectPath) => {
    if (!projectPath) return {};
    return get().sessions[projectPath] ?? {};
  },

  onProjectActivated: async (projectPath) => {
    try {
      // Backend also runs activate_project from set_active_project; calling again
      // is idempotent (re-detect + cancel deactivate + emit).
      const profile = await lspDetectProjectProfile(projectPath);
      get().setProfile(profile);

      const primary = profile.primary;
      if (!primary) return;

      // Soft warm: codemirror language chunk
      const sample = LANG_PRELOAD_FILE[primary.languageId];
      if (sample) {
        preloadLanguageExtension(sample);
      }

      // Soft warm: binary presence (no spawn)
      const installed = await lspCheckServerInstalled(primary.languageId);
      if (!installed) {
        console.info(
          `[LSP] Soft-warm: ${primary.serverName} not on PATH for ${primary.languageId}`,
        );
      }
    } catch (e) {
      console.warn('[LSP] onProjectActivated failed:', e);
    }
  },
}));
