import React, { createContext, useContext } from "react";

export interface ProjectActionsContextValue {
  onRemoveProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onBackToMainTerminal: (projectId: string) => void;
  onOpenIde?: (projectId: string) => void;
  onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
  onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
  onSaveProjectSettings?: (
    projectId: string,
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
  handleSelectProject: (projectId: string) => void;
  handleAddProject: () => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  onWorktreeDiffBack: () => void;
  onFileSelect: (filePath: string) => void;
  onFileRefresh: () => void;
  onFileCloseTab: (tabId: string) => void;
  onFileActivateTab: (tabId: string) => void;
  onFileSave: (content: string) => Promise<boolean>;
  onFileContentChange: (tabId: string, content: string) => void;
  onLoadFileTree: (projectId: string) => void;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

export function ProjectActionsProvider({
  value,
  children,
}: {
  value: ProjectActionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <ProjectActionsContext.Provider value={value}>
      {children}
    </ProjectActionsContext.Provider>
  );
}

export function useProjectActionsContext() {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) {
    throw new Error("useProjectActionsContext must be used within ProjectActionsProvider");
  }
  return ctx;
}
