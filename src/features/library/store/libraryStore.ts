import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useOverlayStore } from '@/shared/store/overlayStore';
import type { ResourceKind, ViewMode, ScopeFilter, PromptResource } from '@/shared/types/library';

import { listPrompts, deletePrompt as deletePromptApi, recordPromptUsage } from '../api/libraryApi';

/** 三个 prompt 弹窗的浮层 id（z-order 专项：弹窗打开期间隐藏内容区 Browser webview）。 */
const PROMPT_EDITOR_OVERLAY_ID = 'prompt-editor';
const PROMPT_INSERT_OVERLAY_ID = 'prompt-insert';
const PROMPT_VARIABLES_OVERLAY_ID = 'prompt-variables';

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

  /** Insert dialog state. */
  insertOpen: boolean;
  /** 待填变量的原始内容；null = 变量弹窗关闭。渲染点见 `PromptDialogHost`。 */
  variableRequest: string | null;
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
  closeEditor: () => void;
  openInsert: () => void;
  closeInsert: () => void;
  /**
   * 请求用户为 `{{var}}` 占位符填值。
   *
   * @returns 渲染后的内容；**取消 / 关闭 / 宿主未挂载时为 `null`** —— 调用方据此既不插入也不计
   *   使用次数。契约与 `confirmStore.request` 同构：Promise 必然结算，绝不悬挂。
   */
  openVariableDialog: (content: string) => Promise<string | null>;
  /** 唯一的变量弹窗关闭 + 结算入口（`rendered === null` 表示未获得内容）。 */
  settleVariableDialog: (rendered: string | null) => void;
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
  insertOpen: false,
  variableRequest: null,
};

// Promise resolver 与宿主就绪标记存 store 外（模块级）：未决 Promise 不可序列化，不进 zustand 状态。
// 宿主标记的必要性同 `confirmStore.hostMounted`：`openVariableDialog` 的 Promise 只有渲染弹窗的宿主
// 才会结算，无宿主时必须按「未获得内容」立即结算，否则 await 方永久挂起（⇒ 插入静默丢失）。
let variableResolver: ((rendered: string | null) => void) | null = null;
let hostMounted = false;

/** `PromptDialogHost` 挂载 / 卸载时同步就绪标记。 */
export function setPromptDialogHostMounted(mounted: boolean): void {
  hostMounted = mounted;
}

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

      openEditor: (prompt) => {
        useOverlayStore.getState().setOverlayOpen(PROMPT_EDITOR_OVERLAY_ID, true);
        set({
          editorOpen: true,
          editorKind: 'prompt',
          editingPrompt: prompt ?? null,
        });
      },
      closeEditor: () => {
        useOverlayStore.getState().setOverlayOpen(PROMPT_EDITOR_OVERLAY_ID, false);
        set({
          editorOpen: false,
          editorKind: null,
          editingPrompt: null,
        });
      },
      openInsert: () => {
        useOverlayStore.getState().setOverlayOpen(PROMPT_INSERT_OVERLAY_ID, true);
        set({ insertOpen: true });
      },
      closeInsert: () => {
        useOverlayStore.getState().setOverlayOpen(PROMPT_INSERT_OVERLAY_ID, false);
        set({ insertOpen: false });
      },
      openVariableDialog: (content) => {
        // 并发请求：旧请求按「未获得内容」结算 —— 用户已转向新的填写，旧的不再插入。
        variableResolver?.(null);
        variableResolver = null;
        if (!hostMounted) return Promise.resolve(null);
        useOverlayStore.getState().setOverlayOpen(PROMPT_VARIABLES_OVERLAY_ID, true);
        set({ variableRequest: content });
        return new Promise<string | null>((resolve) => {
          variableResolver = resolve;
        });
      },
      settleVariableDialog: (rendered) => {
        useOverlayStore.getState().setOverlayOpen(PROMPT_VARIABLES_OVERLAY_ID, false);
        set({ variableRequest: null });
        variableResolver?.(rendered);
        variableResolver = null;
      },
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
