import React from "react";
import {
  ArrowDownFromLine,
  ArrowUpFromLine,
  GitBranch,
  GitCommitHorizontal,
} from "lucide-react";

import type { Project } from "@/shared/types";
import type { DialogType } from "@/features/git/components/GitDialog";
import { FolderGitIcon } from "@/shared/components/icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";

interface ProjectGitMenuProps {
  project: Project;
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** Trigger shown in the project hover action slot. */
  trigger: React.ReactNode;
  onCommit?: (projectId: string) => void;
  onPush?: (projectId: string) => void;
  onPull?: (projectId: string) => void;
  onOpenDialog: (type: DialogType) => void;
}

/** Theme-aligned menu panel (matches skill/project context menus, portal-stacked). */
function menuContentClass(className?: string) {
  return cn(
    "z-[10000] min-w-[11.5rem] overflow-hidden rounded-md border border-border",
    "bg-bg-tertiary text-text-primary p-1",
    "shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
    // Override shadcn popover tokens so theme CSS variables win
    "bg-bg-tertiary text-text-primary",
    className,
  );
}

function menuItemClass(className?: string) {
  return cn(
    "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md",
    "px-2.5 py-1.5 text-[12px] outline-none transition-colors",
    "text-text-primary",
    "focus:bg-bg-hover focus:text-text-primary",
    "data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70",
    className,
  );
}

/**
 * ProjectGitMenu — Git actions for a project row.
 *
 * Uses Radix DropdownMenu + Portal so the panel paints above neighboring
 * project-row hover overlays (fixes clipping / z-index under next row).
 * Styling matches the app's dark context menus rather than default shadcn accents.
 */
const ProjectGitMenu: React.FC<ProjectGitMenuProps> = ({
  project,
  open,
  setOpen,
  trigger,
  onCommit,
  onPush,
  onPull,
  onOpenDialog,
}) => {
  const gitInfo = project.git_info;
  const hasSync = Boolean(gitInfo && (onPush || onPull));
  const hasBranchActions = Boolean(gitInfo);

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "bg-transparent border-none cursor-pointer p-1 rounded-md flex items-center",
              "text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors",
              "data-[state=open]:bg-bg-selected data-[state=open]:text-text-primary",
            )}
            title="Git actions"
            aria-label="Git actions"
            onClick={(e) => e.stopPropagation()}
          >
            {trigger}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          className={menuContentClass()}
          // Keep project row from receiving the click that opened us
          onClick={(e) => e.stopPropagation()}
          data-testid="project-git-menu"
        >
          <DropdownMenuLabel
            className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted"
          >
            Git
          </DropdownMenuLabel>

          {onCommit ? (
            <DropdownMenuItem
              className={menuItemClass()}
              onSelect={() => {
                setOpen(false);
                onCommit(project.id);
              }}
            >
              <GitCommitHorizontal />
              Commit Changes
            </DropdownMenuItem>
          ) : null}

          {hasSync ? (
            <>
              {onCommit ? <DropdownMenuSeparator className="my-1 h-px bg-border" /> : null}
              {onPush ? (
                <DropdownMenuItem
                  className={menuItemClass()}
                  onSelect={() => {
                    setOpen(false);
                    onPush(project.id);
                  }}
                >
                  <ArrowUpFromLine />
                  Push
                </DropdownMenuItem>
              ) : null}
              {onPull ? (
                <DropdownMenuItem
                  className={menuItemClass()}
                  onSelect={() => {
                    setOpen(false);
                    onPull(project.id);
                  }}
                >
                  <ArrowDownFromLine />
                  Pull
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}

          {hasBranchActions ? (
            <>
              <DropdownMenuSeparator className="my-1 h-px bg-border" />
              <DropdownMenuItem
                className={menuItemClass()}
                onSelect={() => {
                  setOpen(false);
                  onOpenDialog("new-branch");
                }}
              >
                <GitBranch />
                New Branch
              </DropdownMenuItem>
              <DropdownMenuItem
                className={menuItemClass()}
                onSelect={() => {
                  setOpen(false);
                  onOpenDialog("new-worktree");
                }}
              >
                <FolderGitIcon size={14} />
                New Worktree
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default React.memo(ProjectGitMenu);
