import type {
  AgentConfig,
  AppConfig,
  RemoteEntrySession,
  RemoteProject,
  WSLEntrySession,
  WSLProject,
} from '@/shared/types';

export type ActiveWslKey = { distro: string; projectId: string } | null;
export type ActiveRemoteKey = { host: string; projectId: string } | null;

export type ConnectionSource =
  | { type: "wsl"; distro: string }
  | {
      type: "remote";
      entryId: string;
      host: string;
      invokeRemoteGit: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
    };

export interface ConnectionProjectCardProps {
  project: WSLProject | RemoteProject;
  entryId: string;
  source: ConnectionSource;
  isActive: boolean;
  /** 整个 ProjectsPanel 是否最后一个项目卡（决定是否画 hairline 分隔） */
  isLast?: boolean;
  onSelectProject: (identifier: string, project: WSLProject | RemoteProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onOpenIde?: (identifier: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (identifier: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
}

export interface WSLItemProps {
  entry: WSLEntrySession;
  activeKey: ActiveWslKey;
  /** 整个 ProjectsPanel 中，本 distro 下最后一个项目卡的 projectId（用于 hairline 派生） */
  lastProjectId?: string | null;
  onSelectProject: (distro: string, project: WSLProject) => void;
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
  onSaveProjectSettings?: (
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}

export interface RemoteItemProps {
  entry: RemoteEntrySession;
  activeKey: ActiveRemoteKey;
  /** 整个 ProjectsPanel 中，本 server 下最后一个项目卡的 projectId（用于 hairline 派生） */
  lastProjectId?: string | null;
  onSelectProject: (host: string, project: RemoteProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (entryId: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}
