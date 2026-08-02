import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useDockStore } from '@/shared/store/dockStore';
import type {
  ActionResource,
  ResourceKind,
  ViewMode,
  ScopeFilter,
  PromptResource,
} from '@/shared/types/library';
import type { McpServer, AgentCapabilities } from '@/shared/types/mcpServer';

import {
  listPrompts,
  deletePrompt as deletePromptApi,
  recordPromptUsage,
  listActions,
  deleteAction as deleteActionApi,
  saveAction as saveActionApi,
  updateAction as updateActionApi,
  runAction as runActionApi,
  listMcpServers,
  saveMcpServer as saveMcpServerApi,
  updateMcpServer as updateMcpServerApi,
  deleteMcpServer as deleteMcpServerApi,
  testMcpServer as testMcpServerApi,
  getAgentCapabilities,
} from '../api/libraryApi';

/** Sort mode for resource lists. */
export type SortMode = 'recent' | 'frequent' | 'alphabetical';

/** Which editor is open — lets the shared editorOpen flag drive the right dialog. */
export type EditorKind = 'prompt' | 'command' | 'action' | 'mcp';

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

  /** Sort mode for resource lists. */
  sortMode: SortMode;

  /** Prompts cache. */
  prompts: PromptResource[];
  promptsLoading: boolean;
  promptsError: string | null;

  /** Actions cache. */
  actions: ActionResource[];
  actionsLoading: boolean;
  actionsError: string | null;

  /** MCP servers cache. */
  mcpServers: McpServer[];
  mcpServersLoading: boolean;
  mcpServersError: string | null;

  /** Commands cache (prompts with kind='command'). */
  commands: PromptResource[];
  commandsLoading: boolean;
  commandsError: string | null;

  /** MCP server being edited (null = creating a new MCP server). */
  editingMcpServer: McpServer | null;

  /** Last active kind + viewMode remembered across panel close/reopen (both persisted). */

  /** Editor dialog state. */
  editorOpen: boolean;
  /** Which resource type the editor is for (disambiguates the shared open flag). */
  editorKind: EditorKind | null;
  editingPrompt: PromptResource | null;
  /** Pre-filled content when opening the editor for a new prompt (e.g. "Save as Prompt"). */
  initialContent: string | null;
  /** Default kind for the next new-prompt creation (set when opening from Commands tab). */
  pendingKind: 'prompt' | 'command';
  /** Action being edited (null = creating a new action). */
  editingAction: ActionResource | null;
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
  setSortMode: (mode: SortMode) => void;

  refreshPrompts: () => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
  recordUsage: (id: string) => Promise<void>;

  refreshActions: () => Promise<void>;
  createAction: (input: {
    name: string;
    description?: string | null;
    group?: string;
    payload: ActionResource['payload'];
    shortcut?: string | null;
    tags?: string[];
  }) => Promise<void>;
  updateAction: (
    id: string,
    input: {
      name: string;
      description?: string | null;
      group?: string;
      payload: ActionResource['payload'];
      shortcut?: string | null;
      tags?: string[];
      enabled?: boolean;
    },
  ) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  executeAction: (id: string) => Promise<void>;

  refreshMcpServers: () => Promise<void>;
  createMcpServer: (input: {
    name: string;
    description?: string | null;
    command: string;
    args?: unknown[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'sse';
    scope?: 'global' | 'project';
    projectId?: string | null;
    tags?: string[];
  }) => Promise<void>;
  updateMcpServer: (
    id: string,
    input: {
      name: string;
      description?: string | null;
      command: string;
      args?: unknown[];
      env?: Record<string, string>;
      transport?: 'stdio' | 'sse';
      scope?: 'global' | 'project';
      projectId?: string | null;
      tags?: string[];
    },
  ) => Promise<void>;
  deleteMcpServer: (id: string) => Promise<void>;
  testMcpConnection: (id: string) => Promise<{
    commandFound: boolean;
    command: string;
    message: string;
  }>;

  refreshCommands: () => Promise<void>;
  openMcpEditor: (server?: McpServer | null) => void;
  closeMcpEditor: () => void;

  getAgentCapabilities: (agentId: string) => Promise<AgentCapabilities | null>;

  /** Detect `{{variable}}` placeholders in content. */
  detectVariables: (content: string) => string[];
  /** Replace `{{variable}}` placeholders using provided values. */
  resolveVariables: (content: string, values: Record<string, string>) => string;

  openEditor: (prompt?: PromptResource | null, defaultKind?: 'prompt' | 'command') => void;
  /** Open the editor for a new prompt with pre-filled content (e.g. "Save as Prompt"). */
  openEditorWithContent: (content: string) => void;
  /** Open the action editor for a new or existing action. */
  openActionEditor: (action?: ActionResource | null) => void;
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
  sortMode: 'recent',
  prompts: [],
  promptsLoading: false,
  promptsError: null,
  actions: [],
  actionsLoading: false,
  actionsError: null,
  mcpServers: [],
  mcpServersLoading: false,
  mcpServersError: null,
  commands: [],
  commandsLoading: false,
  commandsError: null,
  editingMcpServer: null,
  editorOpen: false,
  editorKind: null,
  editingPrompt: null,
  initialContent: null,
  pendingKind: 'prompt',
  editingAction: null,
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

      refreshActions: async () => {
        set({ actionsLoading: true, actionsError: null });
        try {
          const actions = await listActions();
          set({ actions, actionsLoading: false });
        } catch (e) {
          const message = String(e);
          console.error('[libraryStore] refreshActions failed:', e);
          set({ actionsLoading: false, actionsError: message });
        }
      },

      createAction: async (input) => {
        await saveActionApi(input);
        await useLibraryStore.getState().refreshActions();
      },

      updateAction: async (id, input) => {
        await updateActionApi(id, input);
        await useLibraryStore.getState().refreshActions();
      },

      deleteAction: async (id: string) => {
        await deleteActionApi(id);
        set((state) => ({ actions: state.actions.filter((a) => a.id !== id) }));
      },

      executeAction: async (id: string) => {
        try {
          const result = await runActionApi(id);
          if (result.dispatched) {
            if (result.promptContent !== null) {
              window.dispatchEvent(
                new CustomEvent('neeko:insert-to-agent-input', {
                  detail: { text: result.promptContent },
                }),
              );
            }
            if (result.command !== null) {
              // Write to active terminal via the bridge exposed by ProjectWorkspace.
              const insertToTerminal = (
                window as unknown as { __neekoInsertToTerminal?: (text: string) => boolean }
              ).__neekoInsertToTerminal;
              insertToTerminal?.(result.command);
            }
            if (result.panelId !== null) {
              useDockStore.getState().togglePanel(result.panelId);
            }
          }
        } catch (e) {
          console.error('[libraryStore] executeAction failed:', e);
        }
      },

      refreshMcpServers: async () => {
        set({ mcpServersLoading: true, mcpServersError: null });
        try {
          const mcpServers = await listMcpServers();
          set({ mcpServers, mcpServersLoading: false });
        } catch (e) {
          const message = String(e);
          console.error('[libraryStore] refreshMcpServers failed:', e);
          set({ mcpServersLoading: false, mcpServersError: message });
        }
      },

      createMcpServer: async (input) => {
        await saveMcpServerApi({
          name: input.name,
          description: input.description,
          command: input.command,
          args: input.args ?? [],
          env: input.env ?? {},
          transport: input.transport ?? 'stdio',
          scope: input.scope ?? 'global',
          projectId: input.projectId,
          tags: input.tags ?? [],
        });
        await useLibraryStore.getState().refreshMcpServers();
      },

      updateMcpServer: async (id, input) => {
        await updateMcpServerApi(id, {
          name: input.name,
          description: input.description,
          command: input.command,
          args: input.args ?? [],
          env: input.env ?? {},
          transport: input.transport ?? 'stdio',
          scope: input.scope ?? 'global',
          projectId: input.projectId,
          tags: input.tags ?? [],
        });
        await useLibraryStore.getState().refreshMcpServers();
      },

      deleteMcpServer: async (id: string) => {
        await deleteMcpServerApi(id);
        set((state) => ({
          mcpServers: state.mcpServers.filter((s) => s.id !== id),
        }));
      },

      testMcpConnection: async (id: string) => {
        return testMcpServerApi(id);
      },

      refreshCommands: async () => {
        set({ commandsLoading: true, commandsError: null });
        try {
          // Commands are prompts with kind='command'. We reuse listPrompts and filter.
          const allPrompts = await listPrompts();
          const commands = allPrompts.filter(
            (p) => (p as PromptResource & { kind?: string }).kind === 'command',
          );
          set({ commands, commandsLoading: false });
        } catch (e) {
          const message = String(e);
          console.error('[libraryStore] refreshCommands failed:', e);
          set({ commandsLoading: false, commandsError: message });
        }
      },

      openMcpEditor: (server) =>
        set({
          editorOpen: true,
          editorKind: 'mcp',
          editingMcpServer: server ?? null,
          editingAction: null,
          editingPrompt: null,
          initialContent: null,
        }),
      closeMcpEditor: () =>
        set({
          editingMcpServer: null,
          editorOpen: false,
          editorKind: null,
        }),

      getAgentCapabilities: async (agentId: string) => {
        try {
          return await getAgentCapabilities(agentId);
        } catch (e) {
          console.error('[libraryStore] getAgentCapabilities failed:', e);
          return null;
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

      openEditor: (prompt, defaultKind) =>
        set({
          editorOpen: true,
          editorKind: defaultKind ?? 'prompt',
          editingPrompt: prompt ?? null,
          initialContent: null,
          editingAction: null,
          pendingKind: defaultKind ?? 'prompt',
        }),
      openEditorWithContent: (content) =>
        set({
          editorOpen: true,
          editorKind: 'prompt',
          editingPrompt: null,
          initialContent: content,
          editingAction: null,
        }),
      openActionEditor: (action) =>
        set({
          editorOpen: true,
          editorKind: 'action',
          editingAction: action ?? null,
          editingPrompt: null,
          initialContent: null,
        }),
      closeEditor: () =>
        set({
          editorOpen: false,
          editorKind: null,
          editingPrompt: null,
          initialContent: null,
          editingAction: null,
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
      }),
    },
  ),
);

/** Reset transient state (used in tests). */
export const resetLibraryState = () => {
  useLibraryStore.setState(initialState);
};
