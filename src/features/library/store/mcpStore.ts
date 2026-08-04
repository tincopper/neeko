import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  McpServer,
  McpTagGroup,
  McpTagGroupInput,
  McpServerTarget,
  AgentCapabilities,
} from '@/shared/types/mcpServer';

import {
  listMcpServers,
  saveMcpServer as saveMcpServerApi,
  updateMcpServer as updateMcpServerApi,
  deleteMcpServer as deleteMcpServerApi,
  testMcpServer as testMcpServerApi,
  getMcpTagGroups,
  createMcpTagGroup as createMcpTagGroupApi,
  deleteMcpTagGroup as deleteMcpTagGroupApi,
  updateMcpTagGroup as updateMcpTagGroupApi,
  reorderMcpTagGroups as reorderMcpTagGroupsApi,
  addServerToMcpTagGroup,
  removeServerFromMcpTagGroup,
  getProjectMcpTagGroups,
  setProjectMcpTagGroups,
  applyProjectMcpServers,
  getMcpServerTargets,
  getAgentCapabilities,
} from '../api/libraryApi';
import type { McpRegistryGeneratedConfig } from '../api/libraryApi';

/** Read-only registry summary shown in the marketplace install dialog header. */
export interface McpInstallSummary {
  name: string;
  title: string;
  description?: string | null;
  version?: string | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

interface McpState {
  /** MCP servers cache. */
  mcpServers: McpServer[];
  mcpServersLoading: boolean;
  mcpServersError: string | null;

  /** MCP server being edited (null = creating a new MCP server). */
  editingMcpServer: McpServer | null;

  /** MCP tab view — installed list vs marketplace vs agent vs project. */
  mcpView: 'installed' | 'marketplace' | 'agent' | 'project';
  /** Active agent ID when viewing agent-specific MCP servers. */
  activeMcpAgentId: string | null;
  /** Active project ID when viewing project-specific MCP servers. */
  activeMcpProjectId: string | null;
  /** MCP marketplace search query (independent of installed-list search). */
  mcpRegistryQuery: string;
  /** Pre-fill template for the MCP editor when installing from the marketplace. */
  mcpDraft: McpRegistryGeneratedConfig | null;
  /** MCP marketplace total count for toolbar badge. */
  mcpMarketplaceCount: number;
  /** Whether the marketplace install dialog is open. */
  installOpen: boolean;
  /** Read-only registry summary shown in the install dialog header. */
  mcpInstallSummary: McpInstallSummary | null;

  /** MCP tag groups cache. */
  mcpTagGroups: McpTagGroup[];
  mcpTagGroupsLoading: boolean;

  /** Active MCP tag group filter (null = show all). */
  activeMcpTagGroup: string | null;

  /** MCP server deployment targets cache per server. */
  mcpServerTargets: Record<string, McpServerTarget[]>;
}

// ─── Actions ────────────────────────────────────────────────────────────────

interface McpActions {
  refreshMcpServers: () => Promise<void>;
  createMcpServer: (input: {
    name: string;
    description?: string | null;
    command: string;
    url?: string | null;
    args?: unknown[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'sse' | 'http';
    scope?: 'global' | 'project';
    projectId?: string | null;
    sourceRegistry?: string | null;
    sourceRef?: string | null;
    tags?: string[];
  }) => Promise<void>;
  updateMcpServer: (
    id: string,
    input: {
      name: string;
      description?: string | null;
      command: string;
      url?: string | null;
      args?: unknown[];
      env?: Record<string, string>;
      transport?: 'stdio' | 'sse' | 'http';
      scope?: 'global' | 'project';
      projectId?: string | null;
      sourceRegistry?: string | null;
      sourceRef?: string | null;
      tags?: string[];
    },
  ) => Promise<void>;
  deleteMcpServer: (id: string) => Promise<void>;
  testMcpConnection: (id: string) => Promise<{
    commandFound: boolean;
    command: string;
    message: string;
  }>;

  setMcpView: (view: 'installed' | 'marketplace' | 'agent' | 'project') => void;
  setActiveMcpAgentId: (id: string | null) => void;
  setActiveMcpProjectId: (id: string | null) => void;
  setMcpRegistryQuery: (query: string) => void;
  setMcpDraft: (draft: McpRegistryGeneratedConfig | null) => void;
  setMcpMarketplaceCount: (count: number) => void;
  openMcpInstall: (summary: McpInstallSummary, draft: McpRegistryGeneratedConfig) => void;
  closeMcpInstall: () => void;

  /** MCP tag group actions. */
  refreshMcpTagGroups: () => Promise<void>;
  setActiveMcpTagGroup: (id: string | null) => void;
  createMcpTagGroup: (input: McpTagGroupInput) => Promise<McpTagGroup>;
  deleteMcpTagGroup: (id: string) => Promise<void>;
  updateMcpTagGroup: (id: string, input: Partial<McpTagGroupInput>) => Promise<McpTagGroup>;
  reorderMcpTagGroups: (ids: string[]) => Promise<void>;
  addServerToMcpTagGroup: (tagGroupId: string, serverId: string) => Promise<void>;
  removeServerFromMcpTagGroup: (tagGroupId: string, serverId: string) => Promise<void>;

  /** MCP project binding actions. */
  getProjectMcpTagGroups: (projectId: string) => Promise<McpTagGroup[]>;
  setProjectMcpTagGroups: (projectId: string, tagGroupIds: string[]) => Promise<void>;
  applyProjectMcpServers: (projectId: string, projectPath: string) => Promise<void>;

  /** MCP deployment target actions. */
  refreshMcpServerTargets: (serverId: string) => Promise<void>;

  openMcpEditor: (server?: McpServer | null) => void;
  closeMcpEditor: () => void;

  getAgentCapabilities: (agentId: string) => Promise<AgentCapabilities | null>;
}

// ─── Initial state ──────────────────────────────────────────────────────────

const initialMcpState: McpState = {
  mcpServers: [],
  mcpServersLoading: false,
  mcpServersError: null,
  editingMcpServer: null,
  mcpView: 'installed',
  mcpRegistryQuery: '',
  mcpDraft: null,
  mcpMarketplaceCount: 0,
  mcpTagGroups: [],
  mcpTagGroupsLoading: false,
  activeMcpTagGroup: null,
  activeMcpAgentId: null,
  activeMcpProjectId: null,
  mcpServerTargets: {},
  installOpen: false,
  mcpInstallSummary: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useMcpStore = create<McpState & McpActions>()(
  persist(
    (set) => ({
      ...initialMcpState,

      refreshMcpServers: async () => {
        set({ mcpServersLoading: true, mcpServersError: null });
        try {
          const mcpServers = await listMcpServers();
          set({ mcpServers, mcpServersLoading: false });
        } catch (e) {
          const message = String(e);
          console.error('[mcpStore] refreshMcpServers failed:', e);
          set({ mcpServersLoading: false, mcpServersError: message });
        }
      },

      createMcpServer: async (input) => {
        await saveMcpServerApi({
          name: input.name,
          description: input.description,
          command: input.command,
          url: input.url ?? null,
          args: input.args ?? [],
          env: input.env ?? {},
          transport: input.transport ?? 'stdio',
          scope: input.scope ?? 'global',
          projectId: input.projectId,
          sourceRegistry: input.sourceRegistry,
          sourceRef: input.sourceRef,
          tags: input.tags ?? [],
        });
        await useMcpStore.getState().refreshMcpServers();
      },

      updateMcpServer: async (id, input) => {
        await updateMcpServerApi(id, {
          name: input.name,
          description: input.description,
          command: input.command,
          url: input.url ?? null,
          args: input.args ?? [],
          env: input.env ?? {},
          transport: input.transport ?? 'stdio',
          scope: input.scope ?? 'global',
          projectId: input.projectId,
          sourceRegistry: input.sourceRegistry,
          sourceRef: input.sourceRef,
          tags: input.tags ?? [],
        });
        await useMcpStore.getState().refreshMcpServers();
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

      setMcpView: (view) => set({ mcpView: view }),
      setMcpRegistryQuery: (query) => set({ mcpRegistryQuery: query }),
      setMcpDraft: (draft) => set({ mcpDraft: draft }),
      setMcpMarketplaceCount: (count) => set({ mcpMarketplaceCount: count }),
      openMcpInstall: (summary, draft) =>
        set({
          installOpen: true,
          mcpDraft: draft,
          mcpInstallSummary: summary,
        }),
      closeMcpInstall: () =>
        set({
          installOpen: false,
          mcpDraft: null,
          mcpInstallSummary: null,
        }),

      refreshMcpTagGroups: async () => {
        set({ mcpTagGroupsLoading: true });
        try {
          const mcpTagGroups = await getMcpTagGroups();
          set({ mcpTagGroups, mcpTagGroupsLoading: false });
        } catch {
          set({ mcpTagGroupsLoading: false });
        }
      },

      setActiveMcpTagGroup: (id) => set({ activeMcpTagGroup: id }),
      setActiveMcpAgentId: (id) => set({ activeMcpAgentId: id }),
      setActiveMcpProjectId: (id) => set({ activeMcpProjectId: id }),

      createMcpTagGroup: async (input) => {
        const group = await createMcpTagGroupApi(input);
        await useMcpStore.getState().refreshMcpTagGroups();
        return group;
      },

      deleteMcpTagGroup: async (id) => {
        await deleteMcpTagGroupApi(id);
        await useMcpStore.getState().refreshMcpTagGroups();
      },

      updateMcpTagGroup: async (id, input) => {
        const group = await updateMcpTagGroupApi(id, input);
        await useMcpStore.getState().refreshMcpTagGroups();
        return group;
      },

      reorderMcpTagGroups: async (ids) => {
        await reorderMcpTagGroupsApi(ids);
        await useMcpStore.getState().refreshMcpTagGroups();
      },

      addServerToMcpTagGroup: async (tagGroupId, serverId) => {
        await addServerToMcpTagGroup(tagGroupId, serverId);
        await useMcpStore.getState().refreshMcpTagGroups();
      },

      removeServerFromMcpTagGroup: async (tagGroupId, serverId) => {
        await removeServerFromMcpTagGroup(tagGroupId, serverId);
        await useMcpStore.getState().refreshMcpTagGroups();
      },

      getProjectMcpTagGroups: async (projectId) => {
        return getProjectMcpTagGroups(projectId);
      },

      setProjectMcpTagGroups: async (projectId, tagGroupIds) => {
        await setProjectMcpTagGroups(projectId, tagGroupIds);
      },

      applyProjectMcpServers: async (projectId, projectPath) => {
        await applyProjectMcpServers(projectId, projectPath);
      },

      refreshMcpServerTargets: async (serverId) => {
        const targets = await getMcpServerTargets(serverId);
        set((state) => ({
          mcpServerTargets: { ...state.mcpServerTargets, [serverId]: targets },
        }));
      },

      openMcpEditor: (server) =>
        set({
          editingMcpServer: server ?? null,
          mcpDraft: null,
        }),
      closeMcpEditor: () =>
        set({
          editingMcpServer: null,
          mcpDraft: null,
        }),

      getAgentCapabilities: async (agentId: string) => {
        try {
          return await getAgentCapabilities(agentId);
        } catch (e) {
          console.error('[mcpStore] getAgentCapabilities failed:', e);
          return null;
        }
      },
    }),
    {
      name: 'neeko-mcp',
      partialize: (state) => ({
        mcpView: state.mcpView,
      }),
    },
  ),
);

/** Reset transient state (used in tests). */
export const resetMcpState = () => {
  useMcpStore.setState(initialMcpState);
};
