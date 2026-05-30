import { useCallback } from "react";
import { useFileView } from "./useFileView";
import { useFileTabRefresh } from "./useFileTabRefresh";
import { useTabManagement } from "./useTabManagement";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import type { ProjectCommands } from "@/types/activeProject";
import type { AgentConfig } from "@/types/agent";

interface UseEditorOrchestratorParams {
  commands: ProjectCommands | null;
  worktreePath: string | null;
  activeProject: { id: string; path: string } | null;
  activeWslProject: { project: { id: string; path: string } } | null;
  activeRemoteProject: { project: { id: string; path: string } } | null;
  activeWorktreePath: string | null;
  agents: AgentConfig[] | null;
}

export function useEditorOrchestrator(params: UseEditorOrchestratorParams) {
  const { commands, worktreePath: contextWorktreePath, activeProject, activeWslProject, activeRemoteProject, activeWorktreePath, agents } = params;

  const fileView = useFileView(commands, contextWorktreePath);

  const { tabKey, tabs, activeTabId, handleAddTab, handleCloseTab, handleActivateTab, handleTabStatusChange, handleTabAgentClick } = useTabManagement({
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreePath,
    agents,
  });

  useFileTabRefresh(commands);

  const handleFileSelect = useCallback((filePath: string) => { fileView.openFile(filePath); }, [fileView.openFile]);

  const handleFileRefresh = useCallback(() => {
    const projectId = useProjectStore.getState().activeProjectId
      ?? useConnectionStore.getState().activeWslProject?.project.id
      ?? useConnectionStore.getState().activeRemoteProject?.project.id
      ?? null;
    if (!projectId) return;
    const rootPath = useWorktreeStore.getState().activeWorktreePath
      ?? useWorktreeStore.getState().activeWslWorktreePath
      ?? useWorktreeStore.getState().activeRemoteWorktreePath
      ?? useProjectStore.getState().activeProject?.path
      ?? useConnectionStore.getState().activeWslProject?.project.path
      ?? useConnectionStore.getState().activeRemoteProject?.project.path
      ?? undefined;
    fileView.loadFileTree(projectId, rootPath);
  }, [fileView.loadFileTree]);

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

  return { fileView, tabKey, tabs, activeTabId, handleAddTab, handleCloseTab, handleActivateTab, handleTabStatusChange, handleTabAgentClick, handleFileSelect, handleFileRefresh, fileActionsValue };
}
