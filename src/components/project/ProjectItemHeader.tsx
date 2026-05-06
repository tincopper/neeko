import React from "react";
import { getIdeIconByCommand } from "../../utils/idePresets";
import {
  ChevronRightIcon,
  FolderGitIcon,
  GitLogoIcon,
  TrashIcon,
} from "../icons";
import type { DialogType } from "./GitDialog";
import type { Project } from "../../types";

const AVATAR_COLORS = [
  "#61afef",
  "#98c379",
  "#e5c07b",
  "#e06c75",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#67a8e4",
  "#abb2bf",
  "#be5046",
];

function getAvatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { color, backgroundColor: `${color}26` };
}

interface ProjectItemHeaderProps {
  project: Project;
  isActive: boolean;
  projectCollapsed: boolean;
  gitMenuOpen: boolean;
  setGitMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ideCommandOverrides?: Record<string, string>;
  actions: {
    onToggleCollapsed: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onOpenIde?: (projectId: string) => void;
    onOpenDialog: (type: DialogType, e: React.MouseEvent) => void;
    onRemoveProject: (projectId: string) => void;
    onCommit?: (projectId: string) => void;
    onPush?: (projectId: string) => void;
    onPull?: (projectId: string) => void;
  };
}

export default function ProjectItemHeader({
  project,
  isActive,
  projectCollapsed,
  gitMenuOpen,
  setGitMenuOpen,
  ideCommandOverrides,
  actions,
}: ProjectItemHeaderProps) {
  const {
    onToggleCollapsed,
    onContextMenu,
    onOpenIde,
    onOpenDialog,
    onRemoveProject,
    onCommit,
    onPush,
    onPull,
  } = actions;

  const hasGitActions = !!(onCommit || (project.git_info && (onPush || onPull)));

  return (
    <div
      className={`gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover ${isActive ? "bg-bg-tertiary" : ""}`}
      onClick={onToggleCollapsed}
      onContextMenu={onContextMenu}
    >
      <span
        className="gh-project-avatar w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase"
        style={getAvatarStyle(project.name)}
      >
        {project.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
          {project.name}
        </span>
      </div>

      {/* Git dropdown — always visible when active and has actions */}
      {isActive && hasGitActions && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
            onClick={(e) => {
              e.stopPropagation();
              setGitMenuOpen((v) => !v);
            }}
            title="Git actions"
          >
            <GitLogoIcon size={12} />
          </button>
          {gitMenuOpen && (
            <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-md min-w-[150px] z-[1000] shadow-lg overflow-hidden">
              {onCommit && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGitMenuOpen(false);
                    onCommit(project.id);
                  }}
                >
                  <GitLogoIcon size={12} />
                  Commit Changes
                </div>
              )}
              {project.git_info && (
                <>
                  {onPush && (
                    <div
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGitMenuOpen(false);
                        onPush(project.id);
                      }}
                    >
                      <GitLogoIcon size={12} />
                      Push
                    </div>
                  )}
                  {onPull && (
                    <div
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGitMenuOpen(false);
                        onPull(project.id);
                      }}
                    >
                      <GitLogoIcon size={12} />
                      Pull
                    </div>
                  )}
                  <div className="border-t border-border my-0.5" />
                  <div
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                    onClick={(e) => {
                      setGitMenuOpen(false);
                      onOpenDialog("new-branch", e);
                    }}
                  >
                    <GitLogoIcon size={12} />
                    New Branch
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                    onClick={(e) => {
                      setGitMenuOpen(false);
                      onOpenDialog("new-worktree", e);
                    }}
                  >
                    <FolderGitIcon size={12} />
                    New Worktree
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {project.selected_ide && onOpenIde && (
        <button
          className={`gh-ide-btn bg-transparent border-none cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 ml-0.5 text-text-muted hover:!text-accent-blue shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"}`}
          title={`Open in IDE (Ctrl+O)\n${project.selected_ide}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenIde(project.id);
          }}
        >
          <img
            src={getIdeIconByCommand(project.selected_ide, ideCommandOverrides)}
            className="w-3.5 h-3.5 object-contain block"
            alt=""
          />
        </button>
      )}

      <div
        className={`gh-project-actions flex items-center gap-0.5 shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"} transition-opacity duration-150`}
      >
        <button
          className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveProject(project.id);
          }}
          title="Remove"
        >
          <TrashIcon size={12} />
        </button>
      </div>
      <ChevronRightIcon
        size={13}
        className={`text-text-muted w-3.5 shrink-0 transition-transform duration-150 ${projectCollapsed ? "" : "rotate-90"}`}
      />
    </div>
  );
}
