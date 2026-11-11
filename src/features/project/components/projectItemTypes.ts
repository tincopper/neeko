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
  /**
   * 打开**这个项目**的 Tasks（design §4.2c）。
   *
   * 语义是「先选中这个项目，再进 Tasks」—— 不是「进 Tasks 然后自己找项目」：
   * 工作项按项目存，看错项目就是看错数据。所以调用方负责先切项目。
   */
  onOpenTasks?: (projectId: ProjectId) => void;
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
