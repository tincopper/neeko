import type { AgentConfig, AppConfig, Project } from "../../../types";
import type { DialogState } from "@/features/git/components/GitDialog";

export interface ProjectItemActions {
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onBackToMainTerminal: (projectId: string) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onCommit?: (projectId: string) => void;
  onPush?: (projectId: string) => void;
  onPull?: (projectId: string) => void;
  onOpenIde?: (projectId: string) => void;
  onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
  onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (projectId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onSaveProjectSettings?: (
    projectId: string,
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
}

export interface ProjectItemViewConfig {
  ideCommandOverrides?: Record<string, string>;
  agents?: AgentConfig[];
  config?: AppConfig;
}

export interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  actions: ProjectItemActions;
  viewConfig?: ProjectItemViewConfig;
}
