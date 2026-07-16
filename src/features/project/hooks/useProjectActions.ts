import { useCallback, useMemo, useState } from "react";
import { openWslIde, openRemoteIde } from "@/features/project/api/projectApi";
import { getGitInfo } from "@/features/git/api/gitApi";
import {
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslCacheKey,
  refreshRemoteTerminal,
  remoteCacheKey,
  switchAgentInRemoteTerminal,
} from "@/features/terminal/components/terminalCache";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useProjectStore } from "@/features/project/store";
import { useEditorStore } from "@/shared/store";
import type {
  AgentConfig,
  AppConfig,
  RemoteEntrySession,
  Tab,
} from "@/shared/types";
import { updateProjectInEntries } from "@/shared/utils/entryUpdates";
import type { SaveSessionFn } from "@/features/project/hooks/useConnectionProjects";

export type ProjectEnvironment = "wsl" | "remote";

export interface WslDiffState {
  distro: string;
  projectPath: string;
  filePath: string;
}

interface UseProjectActionsParams {
  environment: ProjectEnvironment;
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}

/**
 * 统一的项目 action hook —— 替代 useWslActions / useRemoteActions。
 *
 * 通过 `environment` 参数分派 WSL 或 Remote 的内部实现。
 * 移除了对 worktreeStore 废弃字段（wslActiveWtBranch / remoteActiveWtBranch / etc.）的依赖，
 * 全部使用 worktreeStateMap 的统一接口。
 */
export function useProjectActions({
  environment,
  config,
  showToast,
  saveSession,
}: UseProjectActionsParams) {
  const isWsl = environment === "wsl";

  // ── Store selectors ──────────────────────────────────────────────────────
  const remoteEntries = useConnectionStore((state) => state.remoteEntries);
  const remoteAuthStore = useConnectionStore((state) => state.remoteAuthStore);
  const unifiedActiveWtPath = useWorktreeStore((s) => s.activeWorktreePath);

  // ── Diff state (WSL-only) ────────────────────────────────────────────────
  const [wslDiffState, setWslDiffState] = useState<WslDiffState | null>(null);

  // ── Worktree operations (unified via worktreeStateMap) ──────────────────

  const openWorktreeTerminal = useCallback(
    (worktreePath: string, branch: string) => {
      useWorktreeStore.setState({ activeWorktreePath: worktreePath });
      const pid = useProjectStore.getState().activeProjectId;
      if (pid) {
        useWorktreeStore.setState((s) => {
          const prev = s.worktreeStateMap[pid] ?? {
            activePath: null,
            activeBranch: "",
            opened: [],
          };
          return {
            worktreeStateMap: {
              ...s.worktreeStateMap,
              [pid]: {
                ...prev,
                activeBranch: branch,
                opened: prev.opened.some((item) => item.path === worktreePath)
                  ? prev.opened
                  : [...prev.opened, { path: worktreePath, branch }],
              },
            },
            activeWorktreeBranch: branch,
          };
        });
      }
      if (isWsl) {
        setWslDiffState(null);
      }
    },
    [isWsl, setWslDiffState],
  );

  const resetTransientState = useCallback(() => {
    useWorktreeStore.setState({
      activeWorktreePath: null,
      activeWorktreeBranch: "",
    });
    if (isWsl) {
      setWslDiffState(null);
    }
  }, [isWsl, setWslDiffState]);

  // ── Git refresh ─────────────────────────────────────────────────────────

  const refreshGit = useMemo(() => {
    const handler = async (
      _connectionId: string,
      projectId: string,
      _projectPath: string,
    ): Promise<void> => {
      const gitInfo = await getGitInfo(projectId).catch((e) => {
        console.error(`[${isWsl ? "WSL" : "SSH"}] Failed to refresh git info:`, e);
        return null;
      });
      if (!gitInfo) return;

      const storeKey = isWsl ? "wslEntries" : "remoteEntries";
      useConnectionStore.setState((state: any) => ({
        [storeKey]: updateProjectInEntries(state[storeKey], projectId, (project: any) => ({
          ...project,
          git_info: gitInfo,
        })),
      }));

      useProjectStore.setState((state) => {
        if (!state.activeProject || state.activeProject.id !== projectId) return state;
        return {
          activeProject: { ...state.activeProject, git_info: gitInfo },
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, git_info: gitInfo } : p,
          ),
        };
      });
    };
    return handler;
  }, [isWsl]);

  const handleRefreshGit = useCallback(
    async (connectionId: string, projectId: string, projectPath: string) => {
      await refreshGit(connectionId, projectId, projectPath);
    },
    [refreshGit],
  );

  // ── File selection (WSL-only — Remote uses its own flow) ──────────────

  const handleSelectFile = useCallback(
    (distro: string, projectPath: string, filePath: string) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const projectId = activeProject.id;
      const existingTabs = useEditorStore.getState().tabs[projectId];
      const existingDiffTab = existingTabs?.tabs.find(
        (t) => t.data.kind === "diff" && t.data.filePath === filePath,
      );
      if (existingDiffTab) {
        useEditorStore.getState().activateTab(projectId, existingDiffTab.id);
        return;
      }

      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId,
        title: fileName,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: "diff",
          filePath,
          fileName,
          diffSource: { type: "wsl", distro, projectPath },
        },
      };
      useEditorStore.getState().addTab(projectId, tab);
      useEditorStore.getState().activateTab(projectId, tabId);
    },
    [],
  );

  // ── IDE operations ──────────────────────────────────────────────────────

  const handleOpenIde = useCallback(
    (connectionId: string, projectPath: string, ide: string) => {
      if (!ide) {
        showToast("No IDE selected for this project", "error");
        return;
      }

      if (isWsl) {
        openWslIde(connectionId, projectPath, ide).catch((error) => {
          showToast(String(error), "error");
        });
      } else {
        const entry = (remoteEntries as RemoteEntrySession[]).find(
          (item) => item.id === connectionId,
        );
        if (!entry) return;
        openRemoteIde(entry.host, entry.port, entry.username, projectPath, ide).catch(
          (error) => {
            showToast(String(error), "error");
          },
        );
      }
    },
    [isWsl, remoteEntries, showToast],
  );

  const handleOpenWorktreeTerminal = useCallback(
    (_connectionId: string, worktreePath: string, branch: string) => {
      openWorktreeTerminal(worktreePath, branch);
    },
    [openWorktreeTerminal],
  );

  // ── Agent operations ────────────────────────────────────────────────────

  const updateProjectAgent = useCallback(
    (agent: AgentConfig | null) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const agentId = agent?.id ?? null;
      const storeKey = isWsl ? "wslEntries" : "remoteEntries";
      useConnectionStore.setState((state: any) => ({
        [storeKey]: updateProjectInEntries(
          state[storeKey],
          activeProject.id,
          (project: any) => ({ ...project, selected_agent: agentId }),
        ),
      }));

      useProjectStore.setState((state) => {
        if (state.activeProject?.id !== activeProject.id) return state;
        return { activeProject: { ...state.activeProject, selected_agent: agentId } };
      });
      saveSession().catch(console.error);
    },
    [saveSession, isWsl],
  );

  const handleSelectAgent = useCallback(
    (agent: AgentConfig | null) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const envType = isWsl ? "Wsl" : "Remote";
      if (activeProject.environment.type !== envType) return;

      if (isWsl) {
        const env = activeProject.environment as any;
        const distro = env.distro;
        const cacheKey = wslCacheKey(distro, activeProject.id);
        if (agent) {
          void switchAgentInWslTerminal(
            cacheKey,
            distro,
            activeProject.path,
            activeProject.name,
            agent.id,
            config.terminalFontSize ?? 14,
            config.fontFamily ?? "",
            config.agentCommandOverrides,
          );
        }
        updateProjectAgent(agent);
        if (!agent) {
          setTimeout(() => refreshWslTerminal(cacheKey), 50);
        }
      } else {
        const env = activeProject.environment as any;
        const entryId =
          remoteEntries.find((e) => e.host === env.host)?.id ?? "";
        const cacheKey = remoteCacheKey(entryId, activeProject.id);
        if (agent) {
          void switchAgentInRemoteTerminal(cacheKey, agent.id, config.agentCommandOverrides);
        }
        updateProjectAgent(agent);
        if (!agent) {
          setTimeout(() => refreshRemoteTerminal(cacheKey), 50);
        }
      }
    },
    [isWsl, config, remoteEntries, updateProjectAgent],
  );

  // ── Remote-specific: invokeRemoteGit ────────────────────────────────────

  const invokeRemoteGit = useCallback(
    async (
      command: string,
      entryId: string,
      extra: Record<string, unknown>,
    ): Promise<unknown> => {
      if (isWsl) {
        throw new Error("invokeRemoteGit is only available for Remote projects");
      }
      const { invokeRemoteGitCommand } = await import("@/features/connection/api/connectionApi");
      const entry = (remoteEntries as RemoteEntrySession[]).find(
        (item) => item.id === entryId,
      );
      const auth = remoteAuthStore.get(entryId);
      if (!entry || !auth) {
        throw new Error("No auth for entry");
      }
      return invokeRemoteGitCommand(
        command,
        entry.host,
        entry.port,
        entry.username,
        auth,
        extra,
      );
    },
    [isWsl, remoteEntries, remoteAuthStore],
  );

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    // Worktree state
    activeWorktreePath: unifiedActiveWtPath,
    setActiveWorktreePath: (path: string | null) =>
      useWorktreeStore.setState({ activeWorktreePath: path }),

    // Diff state (WSL-only)
    wslDiffState: isWsl ? wslDiffState : undefined,
    setWslDiffState: isWsl ? setWslDiffState : undefined,

    // Worktree operations
    resetTransientState,
    openWorktreeTerminal,

    // Git refresh
    refreshGit,
    handleRefreshGit,

    // File selection (WSL opens diff tab)
    handleSelectFile: isWsl ? handleSelectFile : undefined,

    // IDE
    handleOpenIde,

    // Worktree terminal
    handleOpenWorktreeTerminal,

    // Agent
    handleSelectAgent,
    updateProjectAgent,

    // Remote-specific
    invokeRemoteGit: isWsl ? undefined : invokeRemoteGit,
  };
}
