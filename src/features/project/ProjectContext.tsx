import React, { createContext, useContext } from 'react';

import type { ProjectId } from '@/shared/utils/workspaceRef';

export interface ProjectActionsContextValue {
  onRemoveProject: (projectId: ProjectId) => void;
  onSelectProject: (projectId: ProjectId) => void;
  onAddProject: () => void;
  onSelectFile: (projectId: ProjectId, filePath: string) => void;
  onRefreshGit: (projectId: ProjectId) => void;
  onBackToMainTerminal: (projectId: ProjectId) => void;
  onOpenIde?: (projectId: ProjectId) => void;
  onOpenWorktreeTerminal?: (projectId: ProjectId, worktreePath: string, branch: string) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
  onSaveProjectSettings?: (
    projectId: ProjectId,
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

export function ProjectActionsProvider({
  value,
  children,
}: {
  value: ProjectActionsContextValue;
  children?: React.ReactNode;
}) {
  return <ProjectActionsContext.Provider value={value}>{children}</ProjectActionsContext.Provider>;
}

export function useProjectActionsContext() {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) {
    throw new Error('useProjectActionsContext must be used within ProjectActionsProvider');
  }
  return ctx;
}
