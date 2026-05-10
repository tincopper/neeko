import type React from "react";
import type {
  AgentConfig,
  AppConfig,
  FileChange,
  GitInfo,
  RemoteEntrySession,
  RemoteProject,
  WSLEntrySession,
  WSLProject,
} from "../../types";

export interface WtConfirmState {
  path: string;
  branch: string;
}

export type ActiveWslKey = { distro: string; projectId: string } | null;
export type ActiveRemoteKey = { host: string; projectId: string } | null;

export interface ProjectCardModel {
  id: string;
  name: string;
  path: string;
  git_info?: GitInfo | null;
  selected_ide?: string | null;
  selected_agent?: string | null;
}

export interface ProjectBodyProps {
  gitInfo: GitInfo | null;
  projectId: string;
  expandedSections: Record<string, boolean>;
  renamingWorktree: string | null;
  renameWorktreeValue: string;
  onToggleSection: (section: string, e: React.MouseEvent) => void;
  onSelectFile: (filePath: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onStartRenameWorktree: (path: string) => void;
  onRenameWorktreeChange: (val: string) => void;
  onCommitRenameWorktree: () => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onCancelRenameWorktree: () => void;
  renameWtInputRef: React.RefObject<HTMLInputElement>;
  onSelectProject: () => void;
  isActive: boolean;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onGetWorktreeChangedFiles?: (worktreePath: string) => Promise<FileChange[]>;
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
}

export interface ProjectItemCardProps {
  project: ProjectCardModel;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: () => void;
  onToggleCollapsed?: () => void;
  onSelectFile: (filePath: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onRemoveProject: () => void;
  onOpenIde?: () => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onGetWorktreeChangedFiles?: (worktreePath: string) => Promise<FileChange[]>;
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
}

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
  hasSession: boolean;
  onSelectProject: (identifier: string, project: WSLProject | RemoteProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onSelectFile?: (identifier: string, projectPath: string, filePath: string) => void;
  onOpenIde?: (identifier: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (identifier: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
}

export interface WSLItemProps {
  entry: WSLEntrySession;
  activeKey: ActiveWslKey;
  openSessions: Set<string>;
  onSelectProject: (distro: string, project: WSLProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onSelectFile?: (distro: string, projectPath: string, filePath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (distro: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}

export interface RemoteItemProps {
  entry: RemoteEntrySession;
  activeKey: ActiveRemoteKey;
  openSessions: Set<string>;
  onSelectProject: (host: string, project: RemoteProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onSelectFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (entryId: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}
