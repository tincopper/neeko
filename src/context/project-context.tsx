import React, { createContext, useContext } from "react";
import type { FileNode, FileTab, Project } from "../types";

interface ProjectContextValue {
   projects: Project[];
   activeProjectId: string | null;
   activeProject: Project | null;
   onRemoveProject: (projectId: string) => void;
   onSelectProject: (projectId: string) => void;
   onSelectFile: (projectId: string, filePath: string) => void;
   onRefreshGit: (projectId: string) => void;
   onBackToMainTerminal: (projectId: string) => void;
   onOpenIde?: (projectId: string) => void;
   onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
   onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
   onDragEnd?: (draggedId: string, targetId: string) => void;
   onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;

   activeWorktreePath: string | null;
   activeWorktreeBranch: string;
   handleSelectProject: (projectId: string) => void;
   handleAddProject: () => void;
   suppressResizeRef?: React.MutableRefObject<boolean>;

   worktreeDiffState: { worktreePath: string; filePath: string } | null;
   onWorktreeDiffBack: () => void;

   fileTree: FileNode[];
   fileTabs: FileTab[];
   activeFileTabId: string | null;
   fileViewLoading: boolean;
   activeFilePath: string | null;
   onFileSelect: (filePath: string) => void;
   onFileRefresh: () => void;
   onFileCloseTab: (tabId: string) => void;
   onFileActivateTab: (tabId: string) => void;
   onFileSave: (content: string) => Promise<boolean>;
   onFileContentChange: (tabId: string, content: string) => void;
   onLoadFileTree: (projectId: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
   value,
   children,
}: {
   value: ProjectContextValue;
   children: React.ReactNode;
}) {
   return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
   const ctx = useContext(ProjectContext);
   if (!ctx) {
      throw new Error("useProjectContext must be used within ProjectProvider");
   }
   return ctx;
}
