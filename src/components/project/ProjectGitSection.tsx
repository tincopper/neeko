import React from "react";
import type { Project } from "../../types";
import type { DialogType } from "./GitDialog";
import WorktreeList from "./WorktreeList";
import { TerminalIcon } from "../icons";

interface ProjectGitSectionProps {
  project: Project;
  isActive: boolean;
  expandedSections: Record<string, boolean>;
  actions: {
    onToggleSection: (key: string, e: React.MouseEvent) => void;
    onSelectProject: (projectId: string) => void;
    onRefreshGit: (projectId: string) => void;
    onOpenDialog: (type: DialogType, e: React.MouseEvent) => void;
    onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
    onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
    onShowToast?: (message: string, type?: "info" | "error") => void;
  };
}

export default function ProjectGitSection({
  project,
  isActive,
  expandedSections,
  actions,
}: ProjectGitSectionProps) {
  const {
    onToggleSection,
    onSelectProject,
    onRefreshGit,
    onOpenWorktreeTerminal,
    onSelectWorktreeFile,
    onShowToast,
  } = actions;

  const worktrees = project.git_info?.worktrees ?? [];

  return (
    <div className="py-0.5 pb-1">
      <div
        className={`group flex items-center gap-1 py-1 px-2 pl-4 mr-1 rounded-md transition-colors duration-100 cursor-pointer ${isActive ? "bg-bg-tertiary/60 text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
        onClick={() => onSelectProject(project.id)}
        title="Open primary terminal"
      >
        <TerminalIcon size={13} className="opacity-70 shrink-0" />
        <span className="flex-1 text-[var(--font-size)] font-semibold truncate min-w-0">
          local
        </span>
      </div>

      <div>
      <WorktreeList
          worktrees={worktrees}
          projectId={project.id}
          expandedSections={expandedSections}
          toggleSection={onToggleSection}
          onOpenWorktreeTerminal={onOpenWorktreeTerminal}
          onSelectWorktreeFile={onSelectWorktreeFile}
          onRefreshGit={onRefreshGit}
          onShowToast={onShowToast}
        />
      </div>
    </div>
  );
}
