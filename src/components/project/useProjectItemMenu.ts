import { useMemo, useState } from "react";
import type { Project } from "../../types";
import type { DialogState } from "./GitDialog";
import type { ContextMenuItem } from "./ContextMenu";
import { FolderGitIcon, GitLogoIcon } from "../icons";

interface UseProjectItemMenuParams {
  project: Project;
  onOpenDialog: (dialog: DialogState) => void;
  onOpenIde?: (projectId: string) => void;
  onRefresh?: (projectId: string) => void;
  onOpenSettings?: () => void;
  onRemoveProject: (projectId: string) => void;
  onCommit?: (projectId: string) => void;
  onPush?: (projectId: string) => void;
  onPull?: (projectId: string) => void;
  hasConfig: boolean;
}

export function useProjectItemMenu({
  project,
  onOpenDialog,
  onOpenIde,
  onRefresh,
  onOpenSettings,
  onRemoveProject,
  onCommit,
  onPush,
  onPull,
  hasConfig,
}: UseProjectItemMenuParams) {
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [];
    const gitInfo = project.git_info;

    if (project.selected_ide && onOpenIde) {
      items.push({
        label: "Open in IDE",
        shortcut: "Ctrl+O",
        action: () => onOpenIde(project.id),
      });
    }

    if (gitInfo) {
      if (onCommit) {
        items.push({
          label: "Commit Changes",
          icon: GitLogoIcon,
          action: () => onCommit(project.id),
        });
      }
      if (onPush) {
        items.push({
          label: "Push",
          icon: GitLogoIcon,
          action: () => onPush(project.id),
        });
      }
      if (onPull) {
        items.push({
          label: "Pull",
          icon: GitLogoIcon,
          action: () => onPull(project.id),
        });
      }
      items.push({
        label: "New Branch",
        icon: GitLogoIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog({
            type: "new-branch",
            projectId: project.id,
            branches: gitInfo.branches,
          });
        },
      });
      items.push({
        label: "New Worktree",
        icon: FolderGitIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog({
            type: "new-worktree",
            projectId: project.id,
            branches: gitInfo.branches,
            projectPath: project.path,
          });
        },
      });
    }

    if (onRefresh) {
      items.push({
        label: "Refresh Terminal",
        shortcut: "Ctrl+Alt+R",
        action: () => onRefresh(project.id),
      });
    }

    items.push({ label: "", separator: true, action: () => {} });

    if (onOpenSettings && hasConfig) {
      items.push({
        label: "Project Settings",
        action: () => setSettingsOpen(true),
      });
    }

    items.push({
      label: "Remove Project",
      action: () => onRemoveProject(project.id),
      danger: true,
    });

    return items;
  }, [
    project,
    onOpenDialog,
    onOpenIde,
    onRefresh,
    onOpenSettings,
    onRemoveProject,
    onCommit,
    onPush,
    onPull,
    hasConfig,
  ]);

  return {
    gitMenuOpen,
    setGitMenuOpen,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    contextMenuItems,
    settingsOpen,
    setSettingsOpen,
  };
}
