/**
 * MRU recent files per project (IDEA Ctrl+E).
 *
 * **去重键是「是不是同一个文件」的判定** ⇒ 必须走身份所有者（`sameIdentity`）：
 * 只做 `\`→`/` 会把同一文件的非规范写法（重复/尾斜杠）当成两个文件，列表出现重复条目。
 */
import { create } from 'zustand';

import { sameIdentity } from '@/shared/utils/fileRef';

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
    set((s) => {
      const prev = s.byProject[projectId] ?? [];
      const next = [
        { projectId, filePath, at: Date.now() },
        ...prev.filter((e) => !sameIdentity(e.filePath, filePath)),
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
