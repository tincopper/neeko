import React, { createContext, useContext } from "react";
import type { FileNode, FileTab, Project } from "../types";

export interface ProjectStateContextValue {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  worktreeDiffState: { worktreePath: string; filePath: string } | null;
  fileTree: FileNode[];
  fileTabs: FileTab[];
  activeFileTabId: string | null;
  fileViewLoading: boolean;
  activeFilePath: string | null;
}

const ProjectStateContext = createContext<ProjectStateContextValue | null>(null);

export function ProjectStateProvider({
  value,
  children,
}: {
  value: ProjectStateContextValue;
  children: React.ReactNode;
}) {
  return (
    <ProjectStateContext.Provider value={value}>
      {children}
    </ProjectStateContext.Provider>
  );
}

export function useProjectStateContext() {
  const ctx = useContext(ProjectStateContext);
  if (!ctx) {
    throw new Error("useProjectStateContext must be used within ProjectStateProvider");
  }
  return ctx;
}
