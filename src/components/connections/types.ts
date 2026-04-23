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
import type { DiffResult } from "../diff/types";

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
  gitInfo: GitInfo;
  projectId: string;
  expandedSections: Record<string, boolean>;
  renamingBranch: string | null;
  renameBranchValue: string;
  renamingWorktree: string | null;
  renameWorktreeValue: string;
  onToggleSection: (section: string, e: React.MouseEvent) => void;
  onCheckoutBranch: (branch: string) => Promise<void>;
  onStartRenameBranch: (branch: string, currentBranch: string) => void;
  onRenameBranchChange: (val: string) => void;
  onCommitRenameBranch: () => void;
  onCancelRename: () => void;
  onSelectFile: (filePath: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onStartRenameWorktree: (path: string) => void;
  onRenameWorktreeChange: (val: string) => void;
  onCommitRenameWorktree: () => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onCancelRenameWorktree: () => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
  renameWtInputRef: React.RefObject<HTMLInputElement>;
  currentBranch: string;
  onSelectProject: () => void;
  isActive: boolean;
  onRefreshGit?: () => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onOpenDialog?: (type: string, branches: string[]) => void;
  onGetWorktreeChangedFiles?: (worktreePath: string) => Promise<FileChange[]>;
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
  onGetWorktreeFileDiff?: (worktreePath: string, filePath: string) => Promise<DiffResult>;
}

export interface ProjectItemCardProps {
  project: ProjectCardModel;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: () => void;
  onSelectFile: (filePath: string) => void;
  onCheckoutBranch: (branch: string) => Promise<void>;
  onCommitRenameBranch: (oldName: string, newName: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onRemoveProject: () => void;
  onOpenIde?: () => void;
  onOpenDialog?: (type: string, branches: string[]) => void;
  currentBranch: string;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onRefreshGit?: () => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onGetWorktreeChangedFiles?: (worktreePath: string) => Promise<FileChange[]>;
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
  onGetWorktreeFileDiff?: (worktreePath: string, filePath: string) => Promise<DiffResult>;
}

export interface WSLProjectCardProps {
  project: WSLProject;
  entryId: string;
  distro: string;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: (distro: string, project: WSLProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onSelectFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenDialog?: (dialog: {
    type: string;
    source: { type: string; distro: string; projectPath: string };
    branches: string[];
  }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
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
  onRefreshGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenDialog?: (dialog: {
    type: string;
    source: { type: string; distro: string; projectPath: string };
    branches: string[];
  }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (distro: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

export interface RemoteProjectCardProps {
  project: RemoteProject;
  entryId: string;
  host: string;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: (host: string, project: RemoteProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onSelectFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onOpenDialog?: (dialog: {
    type: string;
    source: { type: string; entryId: string; projectPath: string };
    branches: string[];
  }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
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
  onRefreshGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onOpenDialog?: (dialog: {
    type: string;
    source: { type: string; entryId: string; projectPath: string };
    branches: string[];
  }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (entryId: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}
