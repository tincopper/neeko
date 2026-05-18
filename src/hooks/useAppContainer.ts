import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type AppProviders from "../AppProviders";
import type AppModals from "../AppModals";
import type AppLayout from "../components/layout/AppLayout";
import type { TitleBar } from "../components/layout";
import { useToast } from "./useToast";
import { useWorktreeState } from "./useWorktreeState";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useAppConfig } from "./useAppConfig";
import { useLocalProjects } from "./useLocalProjects";
import { useWslProjects } from "./useWslProjects";
import { useRemoteProjects } from "./useRemoteProjects";
import { useWslActions } from "./useWslActions";
import { useRemoteActions } from "./useRemoteActions";
import { useSessionBootstrap } from "./useSessionBootstrap";
import { useSessionPersistence } from "./useSessionPersistence";
import { useAgentActions } from "./useAgentActions";
import { useWorktreeActions } from "./useWorktreeActions";
import { useRemoteAuthActions } from "./useRemoteAuthActions";
import { useDelayedInit } from "./useDelayedInit";
import { useTerminalTabs } from "./useTerminalTabs";
import { useAppStore } from "../store/appStore";
import { useFileView } from "./useFileView";
import { useActiveProject } from "./useActiveProject";
import { useSyncToStore } from "./useSyncToStore";
import type { AgentConfig, AuthMethod, RemoteEntrySession, RemoteProject, Tab, WSLEntrySession, WSLProject } from "../types";
import { IS_WINDOWS } from "../utils/platform";
import { buildWorktreeTabKey } from "../utils/tabKey";
import { useFileTabRefresh } from "./useFileTabRefresh";

const APP_SETTINGS_PROJECT_ID = "__app__";
const SETTINGS_TAB_ID = "settings_tab";

type AppProvidersProps = Omit<React.ComponentProps<typeof AppProviders>, "children">;
type AppLayoutProps = React.ComponentProps<typeof AppLayout>;
type AppModalsProps = React.ComponentProps<typeof AppModals>;
type TitleBarProps = React.ComponentProps<typeof TitleBar>;

interface UseAppContainerResult {
  initializing: boolean;
  toast: ReturnType<typeof useToast>["toast"];
  titleBarProps: TitleBarProps;
  appProvidersProps: AppProvidersProps;
  appLayoutProps: AppLayoutProps;
  appModalsProps: AppModalsProps;
}

const noop = () => { };

export function useAppContainer(): UseAppContainerResult {
  const { config, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();
  const local = useLocalProjects();

  const session = useSessionPersistence();
  const wsl = useWslProjects(session.saveSession);
  const remote = useRemoteProjects(session.saveSession, showToast);

  const {
    activeProjectId,
    activeProject,
    loading,
    pendingPath,
    setPendingPath,
    agents,
    loadProjects,
    loadAgents,
    handleAddProject,
    handleConfirmAddProject,
    handleRemoveProject,
    handleSelectFile,
    handleRefreshGit,
    handleOpenIde,
    handleDragEnd,
  } = local;

  const {
    wslEntries,
    setWslEntries,
    activeWslKey,
    activeWslProject,
    wslOpenSessions,
    setWslOpenSessions,
    wslDialogOpen,
    setWslDialogOpen,
    wslAddToEntryId,
    handleWSLEntryAdd,
    handleCloseWslProject,
    handleRemoveWslProject,
    handleRemoveWslEntry,
    handleAddWslProject,
    handleWslDialogClose,
    handleWslDragEnd,
  } = wsl;

  const {
    remoteEntries,
    setRemoteEntries,
    activeRemoteKey,
    activeRemoteProject,
    remoteOpenSessions,
    setRemoteOpenSessions,
    remoteDialogOpen,
    setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore,
    pendingAuthEntry,
    setPendingAuthEntry,
    handleRemoteEntryAdd,
    handleCloseRemoteProject,
    handleRemoveRemoteProject,
    handleRemoveRemoteEntry,
    handleAddRemoteProject,
    handleRemoteDialogClose,
    handleRemoteDragEnd,
    restoreAuthFromEntries,
  } = remote;

  const {
    activeWorktreePath,
    activeWorktreeBranch,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
  } = useWorktreeState(activeProjectId);

  useEffect(() => {
    if (!activeWorktreePath || !activeProject?.git_info) return;
    const exists = activeProject.git_info.worktrees.some(
      (wt) => wt.path === activeWorktreePath,
    );
    if (!exists) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
  }, [
    activeProject?.git_info?.worktrees,
    activeWorktreePath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    activeProject?.git_info,
  ]);

  const remoteActions = useRemoteActions({
    config,
    showToast,
    saveSession: session.saveSession,
  });

  const wslActions = useWslActions({
    config,
    showToast,
    saveSession: session.saveSession,
  });

  const agentActions = useAgentActions({
    terminal: {
      fontSize: config.terminalFontSize ?? 14,
      shell: config.shell ?? "",
      fontFamily: config.fontFamily ?? "",
      gpuAcceleration: config.terminalGpuAcceleration ?? false,
    },
    agentCommandOverrides: config.agentCommandOverrides,
    handleOpenIde,
    showToast,
    saveSession: session.saveSession,
  });

  const worktreeActions = useWorktreeActions({
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState: session.saveWorktreeState,
  });

  const remoteAuthActions = useRemoteAuthActions({
    saveSession: session.saveSession,
  });

  const activeContext = useActiveProject();
  const fileView = useFileView(activeContext.commands, activeContext.worktreePath);

  // ── TitleBar branch switching ─────────────────────────────────────────────
  const [isBranchSwitching, setIsBranchSwitching] = useState(false);

  /** Unified git refresh for the currently active project (local / WSL / remote). */
  const handleTitleBarRefreshGit = useCallback(async () => {
    if (activeProject) {
      await handleRefreshGit(activeProject.id);
    } else if (activeWslProject) {
      await wslActions.handleRefreshWslGit(
        activeWslProject.distro,
        activeWslProject.project.id,
        activeWslProject.project.path,
      );
    } else if (activeRemoteProject) {
      await remoteActions.handleRefreshRemoteGit(
        activeRemoteProject.entry.id,
        activeRemoteProject.project.id,
        activeRemoteProject.project.path,
      );
    }
  }, [
    activeProject,
    activeWslProject,
    activeRemoteProject,
    handleRefreshGit,
    wslActions,
    remoteActions,
  ]);

  const handleTitleBarCheckoutBranch = useCallback(async (branchName: string) => {
    if (!activeContext.commands) return;
    setIsBranchSwitching(true);
    try {
      await activeContext.commands.checkoutBranch(branchName);
      await handleTitleBarRefreshGit();
    } catch (e: unknown) {
      showToast(String(e), "error");
    } finally {
      setIsBranchSwitching(false);
    }
  }, [activeContext.commands, handleTitleBarRefreshGit, showToast]);

  // Close settings tab in __app__ space if open (from no-project state)
  const closeAppSettingsTab = useCallback(() => {
    const appTabs = useAppStore.getState().tabs[APP_SETTINGS_PROJECT_ID];
    if (appTabs) {
      const settingsTab = appTabs.tabs.find((t) => t.data.kind === "settings");
      if (settingsTab) {
        useAppStore.getState().closeTab(APP_SETTINGS_PROJECT_ID, settingsTab.id);
      }
    }
  }, []);

  // clearWslTransientState and clearRemoteTransientState removed.
  // WSL/Remote transient worktree state (path / branch / openedWt) now lives
  // in appStore directly — clearing happens via resetWslTransientState /
  // resetRemoteTransientState or inline in handleSelectProjectWithClear.

  const handleSelectProjectWithClear = useCallback(
    async (projectId: string) => {
      closeAppSettingsTab();

      // Clear WSL/Remote diffState (local useState, batched by React 18 with the
      // appStore.setState below)
      wslActions.setWslDiffState(null);
      remoteActions.setRemoteDiffState(null);

      // ONE appStore.setState: inline clearWorktreeForProject + clear
      // WSL/Remote active + transient worktree + set new active project.
      useAppStore.setState((state) => {
        const targetProjectTabs = state.tabs[projectId];
        // Inline clearWorktreeForProject logic — avoid extra Zustand store update
        const wtCur = state.worktreeStateMap[projectId];
        const nextWtMap = (wtCur && wtCur.activePath !== null)
          ? { ...state.worktreeStateMap, [projectId]: { ...wtCur, activePath: null, activeBranch: "" } }
          : state.worktreeStateMap;
        return {
          worktreeStateMap: nextWtMap,
          activeWslKey: null,
          activeWslProject: null,
          activeRemoteKey: null,
          activeRemoteProject: null,
          activeWslWorktreePath: null,
          wslActiveWtBranch: "",
          wslOpenedWt: [],
          activeRemoteWorktreePath: null,
          remoteActiveWtBranch: "",
          remoteOpenedWt: [],
          activeProjectId: projectId,
          activeProject: state.projects.find((p) => p.id === projectId) ?? null,
          activeTabId: targetProjectTabs?.activeTabId ?? null,
        };
      });

      // Fire-and-forget backend notification
      invoke("set_active_project", { projectId }).catch(console.error);

      const project = useAppStore.getState().activeProject;
      if (project) {
        // Fire-and-forget: 不阻塞项目切换流程，让 Commit Panel 可以立即渲染
        fileView.loadFileTree(projectId, project.path).catch(console.error);
      }
    },
    [closeAppSettingsTab,
      wslActions.setWslDiffState, remoteActions.setRemoteDiffState, fileView],
  );

  const handleSelectWslProjectWithSync = useCallback(
    (distro: string, project: WSLProject) => {
      closeAppSettingsTab();
      remoteActions.resetRemoteTransientState();
      wslActions.handleSelectWslProject(distro, project);
    },
    [closeAppSettingsTab, remoteActions.resetRemoteTransientState, wslActions.handleSelectWslProject],
  );

  const handleOpenWslWorktreeTerminalWithSync = useCallback(
    (distro: string, worktreePath: string, branch: string) => {
      remoteActions.resetRemoteTransientState();
      wslActions.handleOpenWslWorktreeTerminal(distro, worktreePath, branch);
    },
    [remoteActions.resetRemoteTransientState, wslActions.handleOpenWslWorktreeTerminal],
  );

  const handleSelectRemoteProjectWithSync = useCallback(
    (host: string, project: RemoteProject) => {
      closeAppSettingsTab();
      wslActions.resetWslTransientState();
      remoteActions.handleSelectRemoteProject(host, project);
    },
    [closeAppSettingsTab, wslActions.resetWslTransientState, remoteActions.handleSelectRemoteProject],
  );

  const handleOpenRemoteWorktreeTerminalWithSync = useCallback(
    (entryId: string, worktreePath: string, branch: string) => {
      wslActions.resetWslTransientState();
      remoteActions.handleOpenRemoteWorktreeTerminal(entryId, worktreePath, branch);
    },
    [wslActions.resetWslTransientState, remoteActions.handleOpenRemoteWorktreeTerminal],
  );

  const {
    getTabs,
    ensureDefaultTab,
    addTab,
    activateTab,
    updateTabStatus,
    handleAgentClick: handleTabAgentClick,
  } = useTerminalTabs();

  const currentProjectId =
    activeProject?.id ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id ?? null;

  // Tab key: composite when worktree is active, plain projectId otherwise
  // Each worktree gets its own independent tab space (like a separate project)
  // Fallback to __app__ when no project is selected (e.g. settings tab before project load)
  const tabKey = activeWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
    : (currentProjectId ?? APP_SETTINGS_PROJECT_ID);

  // activeTabId 恢复已内联到 setActiveProjectId（useLocalProjects）和
  // setActiveWorktreePath（useWorktreeState）中，与项目/worktree 切换在同一
  // 个 appStore.setState 内完成，不再需要 useEffect 额外渲染。

  useEffect(() => {
    if (!tabKey) return;

    // __app__ space: only used for settings tab, no default terminal needed
    if (tabKey === APP_SETTINGS_PROJECT_ID) return;

    // Local 项目（非 worktree）：不自动创建 tab，让 ProjectGuidePage 引导用户
    if (activeProject && !activeWorktreePath) return;

    // 检查项目是否有任何类型的 tab（不仅是 terminal）
    const projectTabs = useAppStore.getState().tabs[tabKey];
    const hasAnyTabs = projectTabs && projectTabs.tabs.length > 0;

    if (!hasAnyTabs) {
      // 只有在项目没有任何 tab 时才创建默认终端（WSL/Remote 场景）
      const agentId = activeProject?.selected_agent ?? null;
      const agentName = agentId ? (agents?.find((a) => a.id === agentId)?.name ?? undefined) : undefined;
      ensureDefaultTab(tabKey, agentId, agentName);
    }
    // 如果项目已有 tab（任何类型），不做任何操作，保留用户之前的 tab 状态
  }, [tabKey, ensureDefaultTab, activeProject?.selected_agent, agents, activeProject, activeWorktreePath]);

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useAppStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!tabKey) return;
    addTab(tabKey);
  }, [tabKey, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState();
      // Find which project this tab belongs to and close it
      for (const [projectId, pt] of Object.entries(state.tabs)) {
        if (pt.tabs.some((t) => t.id === tabId)) {
          state.closeTab(projectId, tabId);
          return;
        }
      }
    },
    [],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      activateTab(tabKey, tabId);
    },
    [tabKey, activateTab],
  );

  const handleToggleTerminal = useCallback(() => {
    // fileViewOpen removed — toggleTerminal is currently a no-op
  }, []);

  const handleTabStatusChange = useCallback(
    (tabId: string, status: "Idle" | "Running" | "Failed") => {
      if (!tabKey) return;
      updateTabStatus(tabKey, tabId, status);
    },
    [tabKey, updateTabStatus],
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      fileView.openFile(filePath);
    },
    [fileView.openFile],
  );

  const handleFileRefresh = useCallback(() => {
    const state = useAppStore.getState();
    const projectId = state.activeProjectId
      ?? state.activeWslProject?.project.id
      ?? state.activeRemoteProject?.project.id
      ?? null;
    if (!projectId) return;
    const rootPath = state.activeWorktreePath
      ?? state.activeWslWorktreePath
      ?? state.activeRemoteWorktreePath
      ?? state.activeProject?.path
      ?? state.activeWslProject?.project.path
      ?? state.activeRemoteProject?.project.path
      ?? undefined;
    fileView.loadFileTree(projectId, rootPath);
  }, [fileView.loadFileTree]);

  const handleWslDiffBack = useCallback(() => {
    wslActions.setWslDiffState(null);
  }, [wslActions.setWslDiffState]);

  const handleRemoteDiffBack = useCallback(() => {
    remoteActions.setRemoteDiffState(null);
  }, [remoteActions.setRemoteDiffState]);

  const handleToggleSettings = useCallback(() => {
    const state = useAppStore.getState();
    // Find settings tab across all projects
    let targetProject: string | null = null;
    let settingsTabId: string | null = null;
    for (const [projectId, pt] of Object.entries(state.tabs)) {
      const found = pt.tabs.find((t) => t.data.kind === "settings");
      if (found) {
        targetProject = projectId;
        settingsTabId = found.id;
        break;
      }
    }

    if (targetProject && settingsTabId) {
      state.closeTab(targetProject, settingsTabId);
    } else {
      // Add to current project, or fallback to __app__
      const projectId = currentProjectId ?? APP_SETTINGS_PROJECT_ID;
      const existingTabs = state.tabs[projectId];
      const tab: Tab = {
        id: SETTINGS_TAB_ID,
        projectId,
        title: "Settings",
        order: existingTabs?.tabs.length ?? 0,
        data: { kind: "settings" },
      };
      state.addTab(projectId, tab);
      state.activateTab(projectId, SETTINGS_TAB_ID);
    }
  }, [currentProjectId]);

  const handleAddWslClick = useCallback(() => {
    setWslDialogOpen(true);
  }, [setWslDialogOpen]);

  const handleAddRemoteClick = useCallback(() => {
    setRemoteDialogOpen(true);
  }, [setRemoteDialogOpen]);

  const handleAddWslOrNoop = IS_WINDOWS ? handleAddWslClick : noop;

  const { initializing } = useSessionBootstrap({
    loadProjects,
    setWslEntries,
    setRemoteEntries,
    restoreWorktreeState: session.restoreWorktreeState,
    restoreAuthFromEntries,
  });

  // 监听文件系统变更事件，刷新已打开的 file tab 内容
  useFileTabRefresh();

  // Refresh git info for WSL/Remote projects on startup (similar to local projects in useSessionBootstrap)
  const initialWslRemoteRefreshDone = React.useRef(false);
  useEffect(() => {
    if (initializing || initialWslRemoteRefreshDone.current) return;
    initialWslRemoteRefreshDone.current = true;

    // Refresh WSL git info for projects without it
    for (const entry of wslEntries) {
      for (const project of entry.projects) {
        if (!project.git_info) {
          void wslActions.handleRefreshWslGit(entry.distro, project.id, project.path);
        }
      }
    }

    // Refresh Remote git info for projects without it (requires auth)
    for (const entry of remoteEntries) {
      if (!remoteAuthStore.has(entry.id)) continue;
      for (const project of entry.projects) {
        if (!project.git_info) {
          void remoteActions.handleRefreshRemoteGit(entry.id, project.id, project.path);
        }
      }
    }
  }, [initializing, wslEntries, remoteEntries, remoteAuthStore, wslActions, remoteActions]);

  useDelayedInit({ loadAgents });

  const isTerminalView = activeProject?.active_view === "Terminal";

  useSyncToStore({
    isTerminalView: isTerminalView || activeWorktreePath !== null,
    wslEntries,
    activeWslKey,
    activeWslProject,
    remoteEntries,
    activeRemoteKey,
    activeRemoteProject,
    remoteAuthStore,
    pendingAuthEntry,
    worktreeState: session.worktreeState,
    selectProject: handleSelectProjectWithClear,
    selectWslProject: handleSelectWslProjectWithSync,
    selectRemoteProject: handleSelectRemoteProjectWithSync,
    openIde: agentActions.handleOpenIdeCallback,
  });

  useKeyboardShortcuts({
    updateWtPath,
    setWslWorktreePath: wslActions.setActiveWslWorktreePath,
    setWslWtBranch: wslActions.setWslActiveWtBranch,
    setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
    setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
    activeTabId,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    onToggleTerminal: handleToggleTerminal,
  });

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      if (!tabKey) return;
      const newTab = handleTabAgentClick(tabKey, agent);

      if (activeProject) {
        invoke("set_project_agent", {
          projectId: activeProject.id,
          agentId: agent.id,
        }).catch((err: unknown) => {
          console.error("[TitleBar] Failed to set agent:", err);
        });
        if (!newTab) {
          const cacheKey = `${activeProject.id}:1`;
          agentActions.handleSelectLocalAgent(agent, cacheKey);
        }
      } else if (activeWslProject) {
        wslActions.handleSelectWslAgent(agent);
      } else if (activeRemoteProject) {
        remoteActions.handleSelectRemoteAgent(agent);
      }
    },
    [
      tabKey,
      handleTabAgentClick,
      activeProject,
      activeWslProject,
      activeRemoteProject,
      agentActions,
      wslActions,
      remoteActions,
    ],
  );

  const handleToggleHiddenAgent = useCallback(
    (agentId: string) => {
      const current = config.hiddenAgentIds ?? [];
      const next = current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId];
      saveConfig({ ...config, hiddenAgentIds: next });
    },
    [config, saveConfig],
  );

  const projectActionsValue = {
    onRemoveProject: handleRemoveProject,
    onSelectProject: handleSelectProjectWithClear,
    onAddProject: handleAddProject,
    onSelectFile: handleSelectFile,
    onRefreshGit: handleRefreshGit,
    onBackToMainTerminal: worktreeActions.handleBackToMainTerminal,
    onOpenIde: agentActions.handleOpenIdeForSidebar,
    onOpenWorktreeTerminal: worktreeActions.handleOpenWorktreeTerminal,
    onSelectWorktreeFile: worktreeActions.handleSelectWorktreeFile,
    onDragEnd: handleDragEnd,
    onSaveProjectSettings: agentActions.handleSaveProjectSettings,
  };

  const fileActionsValue = {
    onFileSelect: handleFileSelect,
    onFileRefresh: handleFileRefresh,
    onFileCloseTab: fileView.closeTab,
    onFileActivateTab: fileView.activateTab,
    onFileSave: fileView.saveFile,
    onFileContentChange: fileView.updateTabContent,
    onLoadFileTree: fileView.loadFileTree,
    onExpandDir: fileView.expandSubTree,
  };

  const wslValue = {
    wslEntries,
    activeWslKey,
    wslOpenSessions,
    activeWslProject,
    activeWslWorktreePath: wslActions.activeWslWorktreePath,
    wslDiffState: wslActions.wslDiffState,
    setWslOpenSessions,
    onSelectWslProject: handleSelectWslProjectWithSync,
    onCloseWslProject: handleCloseWslProject,
    onRemoveWslProject: handleRemoveWslProject,
    onRemoveWslEntry: handleRemoveWslEntry,
    onAddWslProject: handleAddWslProject,
    onSelectWslFile: wslActions.handleSelectWslFile,
    onRefreshWslGit: wslActions.handleRefreshWslGit,
    onOpenWslIde: wslActions.handleOpenWslIde,
    onOpenWslWorktreeTerminal: handleOpenWslWorktreeTerminalWithSync,
    onWslDiffBack: handleWslDiffBack,
    onWslDragEnd: handleWslDragEnd,
  };

  const remoteValue = {
    remoteEntries,
    activeRemoteKey,
    remoteOpenSessions,
    activeRemoteProject,
    activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
    remoteAuthStore,
    remoteDiffState: remoteActions.remoteDiffState,
    setRemoteOpenSessions,
    onSelectRemoteProject: handleSelectRemoteProjectWithSync,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onSelectRemoteFile: remoteActions.handleSelectRemoteFile,
    onRefreshRemoteGit: remoteActions.handleRefreshRemoteGit,
    onOpenRemoteIde: remoteActions.handleOpenRemoteIde,
    onOpenRemoteWorktreeTerminal: handleOpenRemoteWorktreeTerminalWithSync,
    invokeRemoteGit: remoteActions.invokeRemoteGit,
    onRemoteDiffBack: handleRemoteDiffBack,
    onRemoteDragEnd: handleRemoteDragEnd,
    setPendingAuthEntry,
  };

  const editorValue = {
    tabs,
    activeTabId,
    onActivateTab: handleActivateTab,
    onCloseTab: handleCloseTab,
    onAddTab: handleAddTab,
    onTabStatusChange: handleTabStatusChange,
    agents: agents ?? [],
    compactMode: config.agentSelectorCompactMode ?? false,
    showAgentBar: config.agentSelectorShowPresetBar !== false,
    hiddenAgentIds: config.hiddenAgentIds ?? [],
    onToggleHiddenAgent: handleToggleHiddenAgent,
    onAgentClick: handleAgentClick,
  };

  const titleBarBranches =
    activeProject?.git_info?.branches ??
    activeWslProject?.project.git_info?.branches ??
    activeRemoteProject?.project.git_info?.branches ??
    [];

  const titleBarProps: TitleBarProps = {
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreeBranch,
    activeWslWorktreeBranch: wslActions.wslActiveWtBranch,
    activeRemoteWorktreeBranch: remoteActions.remoteActiveWtBranch,
    branches: titleBarBranches,
    isBranchSwitching,
    onCheckoutBranch: handleTitleBarCheckoutBranch,
    onRefreshGit: handleTitleBarRefreshGit,
  };

  const appProvidersProps: AppProvidersProps = {
    appValue: {
      config,
      agents: agents ?? [],
      agentInstalledMap: {},
      loading,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast,
      saveConfig,
    },
    projectActionsValue,
    fileActionsValue,
    wslValue,
    remoteValue,
    editorValue,
  };

  const appLayoutProps: AppLayoutProps = {
    onAddProject: handleAddProject,
    onAddWsl: handleAddWslOrNoop,
    onAddRemote: handleAddRemoteClick,
    onOpenSettings: handleToggleSettings,
  };

  const appModalsProps: AppModalsProps = {
    addProject: {
      pendingPath,
      onConfirm: handleConfirmAddProject,
      onCancel: () => setPendingPath(null),
      loading,
    },
    wsl: {
      open: wslDialogOpen,
      onClose: handleWslDialogClose,
      onAddWslEntry: async (entry: WSLEntrySession) => {
        await handleWSLEntryAdd(entry);
        // Refresh git info for newly added projects that lack it
        for (const project of entry.projects) {
          if (!project.git_info) {
            void wslActions.handleRefreshWslGit(entry.distro, project.id, project.path);
          }
        }
      },
      entries: wslEntries,
      addToEntryId: wslAddToEntryId,
    },
    remote: {
      open: remoteDialogOpen,
      onClose: handleRemoteDialogClose,
      onAddRemoteEntry: async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
        await handleRemoteEntryAdd(entry, auth, saved_auth);
        // Refresh git info for newly added projects that lack it (requires auth)
        const hasAuth = remoteAuthStore.has(entry.id) || !!auth;
        if (hasAuth) {
          for (const project of entry.projects) {
            if (!project.git_info) {
              void remoteActions.handleRefreshRemoteGit(entry.id, project.id, project.path);
            }
          }
        }
      },
      entries: remoteEntries,
      addToEntryId: remoteAddToEntryId,
      authStore: remoteAuthStore,
    },
    remoteAuth: {
      pendingAuthEntry,
      onCancel: remoteAuthActions.handleRemoteAuthCancel,
      onSuccess: remoteAuthActions.handleRemoteAuthSuccess,
    },
  };

  return {
    initializing,
    toast,
    titleBarProps,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  };
}
