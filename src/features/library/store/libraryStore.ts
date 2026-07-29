import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ResourceKind, ViewMode, ScopeFilter, PromptResource } from '@/shared/types/library';

import { listPrompts, deletePrompt as deletePromptApi, recordPromptUsage } from '../api/libraryApi';

// ─── State ──────────────────────────────────────────────────────────────────

interface LibraryState {
  /** Active resource kind tab. */
  activeKind: ResourceKind;
  /** Search query. */
  searchQuery: string;
  /** Tag filter (AND logic, empty = no filter). */
  tagFilter: string[];
  /** Scope filter (prompts only). */
  scopeFilter: ScopeFilter;
  /** Selected resource id (for detail view). */
  selectedId: string | null;
  /** View mode (grid | list) — persisted. */
  viewMode: ViewMode;

  /** Prompts cache. */
  prompts: PromptResource[];
  promptsLoading: boolean;
  promptsError: string | null;

  /** Last active kind + viewMode remembered across panel close/reopen (both persisted). */

  /** Editor dialog state. */
  editorOpen: boolean;
  editingPrompt: PromptResource | null;
  /** Pre-filled content when opening the editor for a new prompt (e.g. "Save as Prompt"). */
  initialContent: string | null;
  /** Insert dialog state. */
  insertOpen: boolean;
}

// ─── Actions ────────────────────────────────────────────────────────────────

interface LibraryActions {
  setActiveKind: (kind: ResourceKind) => void;
  setSearchQuery: (q: string) => void;
  setTagFilter: (tags: string[]) => void;
  toggleTagFilter: (tag: string) => void;
  setScopeFilter: (scope: ScopeFilter) => void;
  setSelectedId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;

  refreshPrompts: () => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
  recordUsage: (id: string) => Promise<void>;

  openEditor: (prompt?: PromptResource | null) => void;
  /** Open the editor for a new prompt with pre-filled content (e.g. "Save as Prompt"). */
  openEditorWithContent: (content: string) => void;
  closeEditor: () => void;
  openInsert: () => void;
  closeInsert: () => void;
}

// ─── Initial state ──────────────────────────────────────────────────────────

const initialState: LibraryState = {
  activeKind: 'skill',
  searchQuery: '',
  tagFilter: [],
  scopeFilter: 'all',
  selectedId: null,
  viewMode: 'grid',
  prompts: [],
  promptsLoading: false,
  promptsError: null,
  editorOpen: false,
  editingPrompt: null,
  initialContent: null,
  insertOpen: false,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  persist(
    (set) => ({
      ...initialState,

      setActiveKind: (kind) => set({ activeKind: kind, selectedId: null }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setTagFilter: (tags) => set({ tagFilter: tags }),
      toggleTagFilter: (tag) =>
        set((state) => ({
          tagFilter: state.tagFilter.includes(tag)
            ? state.tagFilter.filter((t) => t !== tag)
            : [...state.tagFilter, tag],
        })),
      setScopeFilter: (scope) => set({ scopeFilter: scope }),
      setSelectedId: (id) => set({ selectedId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleViewMode: () =>
        set((state) => ({ viewMode: state.viewMode === 'grid' ? 'list' : 'grid' })),

      refreshPrompts: async () => {
        set({ promptsLoading: true, promptsError: null });
        try {
          const prompts = await listPrompts();
          set({ prompts, promptsLoading: false });
        } catch (e) {
          const message = String(e);
          console.error('[libraryStore] refreshPrompts failed:', e);
          set({ promptsLoading: false, promptsError: message });
        }
      },

      deletePrompt: async (id: string) => {
        await deletePromptApi(id);
        set((state) => ({ prompts: state.prompts.filter((p) => p.id !== id) }));
      },

      recordUsage: async (id: string) => {
        try {
          await recordPromptUsage(id);
        } catch (e) {
          console.error('[libraryStore] recordUsage failed:', e);
        }
      },

      openEditor: (prompt) =>
        set({ editorOpen: true, editingPrompt: prompt ?? null, initialContent: null }),
      openEditorWithContent: (content) =>
        set({ editorOpen: true, editingPrompt: null, initialContent: content }),
      closeEditor: () => set({ editorOpen: false, editingPrompt: null, initialContent: null }),
      openInsert: () => set({ insertOpen: true }),
      closeInsert: () => set({ insertOpen: false }),
    }),
    {
      name: 'neeko-library',
      partialize: (state) => ({ activeKind: state.activeKind, viewMode: state.viewMode }),
    },
  ),
);

/** Reset transient state (used in tests). */
export const resetLibraryState = () => {
  useLibraryStore.setState(initialState);
};
