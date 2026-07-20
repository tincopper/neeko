/**
 * MRU recent files per project (IDEA Ctrl+E).
 */
import { create } from 'zustand';

const MAX_RECENT = 50;

export interface RecentFileEntry {
  projectId: string;
  filePath: string;
  /** epoch ms */
  at: number;
}

interface RecentFilesState {
  /** projectId → MRU list (newest first) */
  byProject: Record<string, RecentFileEntry[]>;
  record: (projectId: string, filePath: string) => void;
  list: (projectId: string) => RecentFileEntry[];
  clearProject: (projectId: string) => void;
}

export const useRecentFilesStore = create<RecentFilesState>((set, get) => ({
  byProject: {},

  record: (projectId, filePath) => {
    if (!projectId || !filePath) return;
    const norm = filePath.replace(/\\/g, '/');
    set((s) => {
      const prev = s.byProject[projectId] ?? [];
      const next = [
        { projectId, filePath: norm, at: Date.now() },
        ...prev.filter((e) => e.filePath !== norm),
      ].slice(0, MAX_RECENT);
      return { byProject: { ...s.byProject, [projectId]: next } };
    });
  },

  list: (projectId) => get().byProject[projectId] ?? [],

  clearProject: (projectId) =>
    set((s) => {
      const next = { ...s.byProject };
      delete next[projectId];
      return { byProject: next };
    }),
}));
