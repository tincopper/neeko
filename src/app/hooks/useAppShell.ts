import React, { useCallback, useEffect } from "react";
import type AppProviders from "../../app/AppProviders";
import type AppModals from "../../app/AppModals";
import type AppLayout from "../../layout/AppLayout";
import type { TitleBar } from "../../layout";
import { useToast } from "@/shared/hooks/useToast";
import { useWorktreeState } from "@/features/project/hooks/useWorktreeState";
import { useKeyboardShortcuts } from "@/shared/hooks/useKeyboardShortcuts";
import { useAppConfig } from "@/features/settings/hooks/useAppConfig";
import { useLocalProjects } from "@/features/project/hooks/useLocalProjects";
import { useWslProjects } from "@/features/connection/hooks/useWslProjects";
import { useRemoteProjects } from "@/features/connection/hooks/useRemoteProjects";
import { useWslActions } from "@/features/connection/hooks/useWslActions";
import { useRemoteActions } from "@/features/connection/hooks/useRemoteActions";
import { useSessionBootstrap } from "@/features/session/hooks/useSessionBootstrap";
import { useSessionPersistence } from "@/features/session/hooks/useSessionPersistence";
import { useAgentActions } from "@/features/agent/hooks/useAgentActions";
import { useWorktreeActions } from "@/features/project/hooks/useWorktreeActions";
import { useRemoteAuthActions } from "@/features/connection/hooks/useRemoteAuthActions";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useFileView } from "@/app/editor/hooks/useFileView";
import { useActiveProject } from "@/features/project/hooks/useActiveProject";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "@/types";
import { useFileTabRefresh } from "@/app/editor/hooks/useFileTabRefresh";
import { useAppLayoutProps } from "@/layout/hooks/useAppLayoutProps";
import { useTitleBarProps } from "@/layout/hooks/useTitleBarProps";
import { useProjectSelection } from "@/features/project/hooks/useProjectSelection";
import { useTabManagement } from "@/app/editor/hooks/useTabManagement";
import { useAgentClickHandler } from "@/features/agent/hooks/useAgentClickHandler";
import { useUnifiedProjectList } from "@/features/project/hooks/useUnifiedProjectList";
import { useCrossTypeSelection } from "@/features/project/hooks/useCrossTypeSelection";

type AppProvidersProps = Omit<React.ComponentProps<typeof AppProviders>, "children">;
type AppLayoutProps = React.ComponentProps<typeof AppLayout>;
type AppModalsProps = React.ComponentProps<typeof AppModals>;
type TitleBarProps = React.ComponentProps<typeof TitleBar>;

interface UseAppShellResult {
  initializing: boolean;
  toast: ReturnType<typeof useToast>["toast"];
  titleBarProps: TitleBarProps;
  appProvidersProps: AppProvidersProps;
  appLayoutProps: AppLayoutProps;
  appModalsProps: AppModalsProps;
}

export function useAppShell(): UseAppShellResult {
  const { config, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();
  const local = useLocalProjects();
  const session = useSessionPersistence();
  const wsl = useWslProjects(session.saveSession);
  const remote = useRemoteProjects(session.saveSession, showToast);

  const { activeProjectId, activeProject, loading, pendingPath, setPendingPath, agents, loadProjects, loadAgents, handleAddProject, handleConfirmAddProject, handleRemoveProject, handleSelectFile, handleRefreshGit, handleOpenIde, handleDragEnd } = local;
  const { wslEntries, setWslEntries, activeWslKey, activeWslProject, wslOpenSessions, setWslOpenSessions, wslDialogOpen, setWslDialogOpen, wslAddToEntryId, handleWSLEntryAdd, handleCloseWslProject, handleRemoveWslProject, handleRemoveWslEntry, handleAddWslProject, handleWslDialogClose, handleWslDragEnd } = wsl;
  const { remoteEntries, setRemoteEntries, activeRemoteKey, activeRemoteProject, remoteOpenSessions, setRemoteOpenSessions, remoteDialogOpen, setRemoteDialogOpen, remoteAddToEntryId, remoteAuthStore, pendingAuthEntry, setPendingAuthEntry, handleRemoteEntryAdd, handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry, handleAddRemoteProject, handleRemoteDialogClose, handleRemoteDragEnd, restoreAuthFromEntries } = remote;

  const { activeWorktreePath, activeWorktreeBranch, updateWtPath, setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees } = useWorktreeState(activeProjectId);
  useEffect(() => { if (!activeWorktreePath || !activeProject?.git_info) return; if (!activeProject.git_info.worktrees.some((wt) => wt.path === activeWorktreePath)) { setActiveWorktreePath(null); setActiveWorktreeBranch(""); } }, [activeProject?.git_info?.worktrees, activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, activeProject?.git_info]);

  const remoteActionsWrap = useRemoteActions({ config, showToast, saveSession: session.saveSession });
  const wslActionsWrap = useWslActions({ config, showToast, saveSession: session.saveSession });
  const agentActionsWrap = useAgentActions({ terminal: { fontSize: config.terminalFontSize ?? 14, shell: config.shell ?? "", fontFamily: config.fontFamily ?? "", gpuAcceleration: config.terminalGpuAcceleration ?? false }, agentCommandOverrides: config.agentCommandOverrides, handleOpenIde, showToast, saveSession: session.saveSession });
  const worktreeActionsWrap = useWorktreeActions({ setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees, saveWorktreeState: session.saveWorktreeState });
  const remoteAuthActions = useRemoteAuthActions({ saveSession: session.saveSession });
  const activeContext = useActiveProject();
  const fileView = useFileView(activeContext.commands, activeContext.worktreePath);
  const { selectProject } = useProjectSelection();
  const cross = useCrossTypeSelection({ wslActions: wslActionsWrap, remoteActions: remoteActionsWrap, selectProject });
  const { tabKey, tabs, activeTabId, handleAddTab, handleCloseTab, handleActivateTab, handleTabStatusChange, handleTabAgentClick } = useTabManagement({ activeProject, activeWslProject, activeRemoteProject, activeWorktreePath, agents });
  const handleFileSelect = useCallback((filePath: string) => { fileView.openFile(filePath); }, [fileView.openFile]);
  const handleFileRefresh = useCallback(() => { const projectId = useProjectStore.getState().activeProjectId ?? useConnectionStore.getState().activeWslProject?.project.id ?? useConnectionStore.getState().activeRemoteProject?.project.id ?? null; if (!projectId) return; const rootPath = useWorktreeStore.getState().activeWorktreePath ?? useWorktreeStore.getState().activeWslWorktreePath ?? useWorktreeStore.getState().activeRemoteWorktreePath ?? useProjectStore.getState().activeProject?.path ?? useConnectionStore.getState().activeWslProject?.project.path ?? useConnectionStore.getState().activeRemoteProject?.project.path ?? undefined; fileView.loadFileTree(projectId, rootPath); }, [fileView.loadFileTree]);
  const handleWslDiffBack = useCallback(() => { wslActionsWrap.setWslDiffState(null); }, [wslActionsWrap.setWslDiffState]);

  const { initializing } = useSessionBootstrap({ loadProjects, setWslEntries, setRemoteEntries, restoreWorktreeState: session.restoreWorktreeState, restoreAuthFromEntries });
  useFileTabRefresh(activeContext.commands);

  const initialWslRemoteRefreshDone = React.useRef(false);
  useEffect(() => { if (initializing || initialWslRemoteRefreshDone.current) return; initialWslRemoteRefreshDone.current = true; for (const entry of wslEntries) { for (const project of entry.projects) { if (!project.git_info) void wslActionsWrap.handleRefreshWslGit(entry.distro, project.id, project.path); } } for (const entry of remoteEntries) { if (!remoteAuthStore.has(entry.id)) continue; for (const project of entry.projects) { if (!project.git_info) void remoteActionsWrap.handleRefreshRemoteGit(entry.id, project.id, project.path); } } }, [initializing, wslEntries, remoteEntries, remoteAuthStore, wslActionsWrap, remoteActionsWrap]);
  useEffect(() => { const t = setTimeout(() => { loadAgents(); }, 100); return () => clearTimeout(t); }, [loadAgents]);
  useEffect(() => { loadAgents(); }, [config, loadAgents]);

  const isTerminalView = activeProject?.active_view === "Terminal";
  useEffect(() => { useProjectStore.setState({ isTerminalView: isTerminalView || activeWorktreePath !== null, selectProject: cross.handleSelectProject, openIde: agentActionsWrap.handleOpenIdeCallback, setProjectIde: agentActionsWrap.handleSetProjectIde }); }, [isTerminalView, activeWorktreePath, cross.handleSelectProject, agentActionsWrap.handleOpenIdeCallback, agentActionsWrap.handleSetProjectIde]);
  useEffect(() => { useConnectionStore.setState({ selectWslProject: cross.handleSelectWslProject, selectRemoteProject: cross.handleSelectRemoteProject }); }, [cross.handleSelectWslProject, cross.handleSelectRemoteProject]);

  useKeyboardShortcuts({ updateWtPath, setWslWorktreePath: wslActionsWrap.setActiveWslWorktreePath, setWslWtBranch: wslActionsWrap.setWslActiveWtBranch, setRemoteWorktreePath: remoteActionsWrap.setActiveRemoteWorktreePath, setRemoteWtBranch: remoteActionsWrap.setRemoteActiveWtBranch, activeTabId, onCloseTab: handleCloseTab, shortcuts: config.shortcuts, unifiedItems: useUnifiedProjectList().items });
  const { handleAgentClick } = useAgentClickHandler({ tabKey, handleTabAgentClick, activeProject, activeWslProject, activeRemoteProject, agentActions: agentActionsWrap, wslActions: wslActionsWrap, remoteActions: remoteActionsWrap });
  const handleToggleHiddenAgent = useCallback((agentId: string) => { const current = config.hiddenAgentIds ?? []; const next = current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]; saveConfig({ ...config, hiddenAgentIds: next }); }, [config, saveConfig]);

  const projectActionsValue = { onRemoveProject: handleRemoveProject, onSelectProject: cross.handleSelectProject, onAddProject: handleAddProject, onSelectFile: handleSelectFile, onRefreshGit: handleRefreshGit, onBackToMainTerminal: worktreeActionsWrap.handleBackToMainTerminal, onOpenIde: agentActionsWrap.handleOpenIdeForSidebar, onOpenWorktreeTerminal: worktreeActionsWrap.handleOpenWorktreeTerminal, onSelectWorktreeFile: worktreeActionsWrap.handleSelectWorktreeFile, onDragEnd: handleDragEnd, onSaveProjectSettings: agentActionsWrap.handleSaveProjectSettings };
  const fileActionsValue = { onFileSelect: handleFileSelect, onFileRefresh: handleFileRefresh, onFileCloseTab: fileView.closeTab, onFileActivateTab: fileView.activateTab, onFileSave: fileView.saveFile, onFileContentChange: fileView.updateTabContent, onLoadFileTree: fileView.loadFileTree, onExpandDir: fileView.expandSubTree };
  const wslValue = { wslEntries, activeWslKey, wslOpenSessions, activeWslProject, activeWslWorktreePath: wslActionsWrap.activeWslWorktreePath, wslDiffState: wslActionsWrap.wslDiffState, setWslOpenSessions, onSelectWslProject: cross.handleSelectWslProject, onCloseWslProject: handleCloseWslProject, onRemoveWslProject: handleRemoveWslProject, onRemoveWslEntry: handleRemoveWslEntry, onAddWslProject: handleAddWslProject, onSelectWslFile: wslActionsWrap.handleSelectWslFile, onRefreshWslGit: wslActionsWrap.handleRefreshWslGit, onOpenWslIde: wslActionsWrap.handleOpenWslIde, onOpenWslWorktreeTerminal: cross.handleOpenWslWorktreeTerminal, onWslDiffBack: handleWslDiffBack, onWslDragEnd: handleWslDragEnd };
  const remoteValue = { remoteEntries, activeRemoteKey, remoteOpenSessions, activeRemoteProject, activeRemoteWorktreePath: remoteActionsWrap.activeRemoteWorktreePath, remoteAuthStore, setRemoteOpenSessions, onSelectRemoteProject: cross.handleSelectRemoteProject, onCloseRemoteProject: handleCloseRemoteProject, onRemoveRemoteProject: handleRemoveRemoteProject, onRemoveRemoteEntry: handleRemoveRemoteEntry, onAddRemoteProject: handleAddRemoteProject, onRefreshRemoteGit: remoteActionsWrap.handleRefreshRemoteGit, onOpenRemoteIde: remoteActionsWrap.handleOpenRemoteIde, onOpenRemoteWorktreeTerminal: cross.handleOpenRemoteWorktreeTerminal, invokeRemoteGit: remoteActionsWrap.invokeRemoteGit, onRemoteDragEnd: handleRemoteDragEnd, setPendingAuthEntry };
  const editorValue = { tabs, activeTabId, onActivateTab: handleActivateTab, onCloseTab: handleCloseTab, onAddTab: handleAddTab, onTabStatusChange: handleTabStatusChange, agents: agents ?? [], compactMode: config.agentSelectorCompactMode ?? false, showAgentBar: config.agentSelectorShowPresetBar !== false, hiddenAgentIds: config.hiddenAgentIds ?? [], onToggleHiddenAgent: handleToggleHiddenAgent, onAgentClick: handleAgentClick };

  const titleBarProps = useTitleBarProps({ activeProject, activeWslProject, activeRemoteProject, activeWorktreeBranch, handleRefreshGit, handleRefreshWslGit: wslActionsWrap.handleRefreshWslGit, handleRefreshRemoteGit: remoteActionsWrap.handleRefreshRemoteGit, wslActiveWtBranch: wslActionsWrap.wslActiveWtBranch, remoteActiveWtBranch: remoteActionsWrap.remoteActiveWtBranch, checkoutBranch: activeContext.commands?.checkoutBranch ?? null, showToast });
  const appProvidersProps: AppProvidersProps = { appValue: { config, agents: agents ?? [], agentInstalledMap: {}, loading, ideCommandOverrides: config.ideCommandOverrides ?? {}, showToast, saveConfig }, projectActionsValue, fileActionsValue, wslValue, remoteValue, editorValue };
  const appLayoutProps = useAppLayoutProps({ onAddProject: handleAddProject, onOpenWslDialog: () => setWslDialogOpen(true), onOpenRemoteDialog: () => setRemoteDialogOpen(true) });

  const handleWslEntryAddRefresh = useCallback(async (entry: WSLEntrySession) => { await handleWSLEntryAdd(entry); for (const project of entry.projects) { if (!project.git_info) void wslActionsWrap.handleRefreshWslGit(entry.distro, project.id, project.path); } }, [handleWSLEntryAdd, wslActionsWrap]);
  const handleRemoteEntryAddRefresh = useCallback(async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => { await handleRemoteEntryAdd(entry, auth, saved_auth); const hasAuth = remoteAuthStore.has(entry.id) || !!auth; if (hasAuth) { for (const project of entry.projects) { if (!project.git_info) void remoteActionsWrap.handleRefreshRemoteGit(entry.id, project.id, project.path); } } }, [handleRemoteEntryAdd, remoteAuthStore, remoteActionsWrap]);

  const appModalsProps: AppModalsProps = { pendingPath, onConfirmAddProject: handleConfirmAddProject, onCancelAddProject: () => setPendingPath(null), loading, wslDialogOpen, wslAddToEntryId, wslEntries, onWslDialogClose: handleWslDialogClose, onAddWslEntry: handleWslEntryAddRefresh, remoteDialogOpen, remoteAddToEntryId, remoteEntries, onRemoteDialogClose: handleRemoteDialogClose, onAddRemoteEntry: handleRemoteEntryAddRefresh, remoteAuthStore, pendingAuthEntry, onRemoteAuthCancel: remoteAuthActions.handleRemoteAuthCancel, onRemoteAuthSuccess: remoteAuthActions.handleRemoteAuthSuccess };

  return { initializing, toast, titleBarProps, appProvidersProps, appLayoutProps, appModalsProps };
}
