import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ResourceKind, ViewMode, ScopeFilter, PromptResource } from '@/shared/types/library';

import { listPrompts, deletePrompt as deletePromptApi, recordPromptUsage } from '../api/libraryApi';

/** Sort mode for resource lists. */
export type SortMode = 'recent' | 'frequent' | 'alphabetical';

/** Which editor is open — lets the shared editorOpen flag drive the right dialog. */
export type EditorKind = 'prompt' | 'mcp';

/** Variable context for resolving `{{var}}` placeholders. */
export interface VariableContext {
  branch?: string | null;
  projectName?: string | null;
  filePath?: string | null;
  projectPath?: string | null;
}

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
  /** Nav column width as a percentage (0-100) of the Library center area — persisted. Default 18. */
  navSize: number;

  /** Sort mode for resource lists. */
  sortMode: SortMode;

  /** Prompts cache. */
  prompts: PromptResource[];
  promptsLoading: boolean;
  promptsError: string | null;

  /** Last active kind + viewMode remembered across panel close/reopen (both persisted). */

  /** Editor dialog state. */
  editorOpen: boolean;
  /** Which resource type the editor is for (disambiguates the shared open flag). */
  editorKind: EditorKind | null;
  editingPrompt: PromptResource | null;
  /** Pre-filled content when opening the editor for a new prompt (e.g. "Save as Prompt"). */
  initialContent: string | null;

  /** Insert dialog state. */
  insertOpen: boolean;
  /** Variable dialog state — content pending variable fill. */
  variableDialogOpen: boolean;
  variableDialogContent: string | null;
  /** Callback invoked with the rendered content after variable fill. */
  variableDialogResolve: ((rendered: string) => void) | null;
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
  setNavSize: (size: number) => void;
  setSortMode: (mode: SortMode) => void;

  refreshPrompts: () => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
  recordUsage: (id: string) => Promise<void>;

  /** Detect `{{variable}}` placeholders in content. */
  detectVariables: (content: string) => string[];
  /** Replace `{{variable}}` placeholders using provided values. */
  resolveVariables: (content: string, values: Record<string, string>) => string;

  openEditor: (prompt?: PromptResource | null) => void;
  /** Open the editor for a new prompt with pre-filled content (e.g. "Save as Prompt"). */
  openEditorWithContent: (content: string) => void;
  closeEditor: () => void;
  openInsert: () => void;
  closeInsert: () => void;
  /** Open the variable dialog for content with `{{var}}` placeholders. */
  openVariableDialog: (content: string) => Promise<string>;
  closeVariableDialog: () => void;
}

// ─── Initial state ──────────────────────────────────────────────────────────

const initialState: LibraryState = {
  activeKind: 'skill',
  searchQuery: '',
  tagFilter: [],
  scopeFilter: 'all',
  selectedId: null,
  viewMode: 'grid',
  navSize: 18,
  sortMode: 'recent',
  prompts: [],
  promptsLoading: false,
  promptsError: null,
  editorOpen: false,
  editorKind: null,
  editingPrompt: null,
  initialContent: null,
  insertOpen: false,
  variableDialogOpen: false,
  variableDialogContent: null,
  variableDialogResolve: null,
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
      setNavSize: (size) => set({ navSize: size }),
      setSortMode: (mode) => set({ sortMode: mode }),

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

      detectVariables: (content: string) => {
        const matches = content.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g);
        if (!matches) return [];
        const vars = new Set<string>();
        for (const m of matches) {
          vars.add(m.slice(2, -2));
        }
        return Array.from(vars);
      },

      resolveVariables: (content: string, values: Record<string, string>) =>
        content.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, name: string) =>
          name in values ? values[name] : `{{${name}}}`,
        ),

      openEditor: (prompt) =>
        set({
          editorOpen: true,
          editorKind: 'prompt',
          editingPrompt: prompt ?? null,
          initialContent: null,
        }),
      openEditorWithContent: (content) =>
        set({
          editorOpen: true,
          editorKind: 'prompt',
          editingPrompt: null,
          initialContent: content,
        }),
      closeEditor: () =>
        set({
          editorOpen: false,
          editorKind: null,
          editingPrompt: null,
          initialContent: null,
        }),
      openInsert: () => set({ insertOpen: true }),
      closeInsert: () => set({ insertOpen: false }),
      openVariableDialog: (content) =>
        new Promise<string>((resolve) => {
          set({
            variableDialogOpen: true,
            variableDialogContent: content,
            variableDialogResolve: (rendered: string) => {
              resolve(rendered);
            },
          });
        }),
      closeVariableDialog: () =>
        set({
          variableDialogOpen: false,
          variableDialogContent: null,
          variableDialogResolve: null,
        }),
    }),
    {
      name: 'neeko-library',
      partialize: (state) => ({
        activeKind: state.activeKind,
        viewMode: state.viewMode,
        sortMode: state.sortMode,
        navSize: state.navSize,
      }),
    },
  ),
);

/** Reset transient state (used in tests). */
export const resetLibraryState = () => {
  useLibraryStore.setState(initialState);
};
