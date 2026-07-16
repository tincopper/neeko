import type {
  AgentConfig,
  AppConfig,
  RemoteEntrySession,
  WSLEntrySession,
} from '@/shared/types';
import type { Project } from '@/features/project/types';

export type ConnectionSource =
  | { type: 'wsl'; distro: string }
  | { type: 'remote'; entryId: string; host: string };

export interface ConnectionProjectCardProps {
  project: Project;
  entryId: string;
  source: ConnectionSource;
  isActive: boolean;
  isLast?: boolean;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onOpenIde?: (identifier: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (identifier: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

export interface WSLItemProps {
  entry: WSLEntrySession;
  lastProjectId?: string | null;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (distro: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}

export interface RemoteItemProps {
  entry: RemoteEntrySession;
  lastProjectId?: string | null;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (entryId: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}
