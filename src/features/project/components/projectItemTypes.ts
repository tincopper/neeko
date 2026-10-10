import type { DialogState } from '@/shared/components/GitDialog';
import type { AgentConfig, AppConfig, Project } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

export interface ProjectItemActions {
  onSelectProject: (projectId: ProjectId) => void;
  onRemoveProject: (projectId: ProjectId) => void;
  onSelectFile: (projectId: ProjectId, filePath: string) => void;
  onRefreshGit: (projectId: ProjectId) => void;
  onBackToMainTerminal: (projectId: ProjectId) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onCommit?: (projectId: ProjectId) => void;
  onPush?: (projectId: ProjectId) => void;
  onPull?: (projectId: ProjectId) => void;
  onOpenIde?: (projectId: ProjectId) => void;
  onOpenWorktreeTerminal?: (projectId: ProjectId, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (projectId: ProjectId) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onSaveProjectSettings?: (
    projectId: ProjectId,
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
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
