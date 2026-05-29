import type { AgentConfig } from "@/features/agent/types";
import type { WSLProject, RemoteProject } from "@/features/connection/types";
import type { GitInfo } from "@/features/git/types";

export interface Project {
  id: string;
  name: string;
  path: string;
  git_info: GitInfo | null;
  terminal: {
    id: string;
    pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[];
    agent: AgentConfig | null;
  };
  selected_agent: string | null;
  selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
  avatar_color?: string | null;
}

export type TerminalEntry =
  | { type: "local"; project: Project }
  | { type: "wsl"; distro: string; project: WSLProject }
  | { type: "remote"; host: string; project: RemoteProject };

export type ProjectType = "local" | "wsl" | "remote";

export interface UnifiedProject {
  type: ProjectType;
  id: string;
  name: string;
  path: string;
  gitInfo?: GitInfo | null;
  selectedAgent?: string | null;
  selectedIde?: string | null;
  activeView: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
}

// ─── Active Project Types ───────────────────────────────────────────────────
import type {
  AheadBehind, CommitEntry, CommitDetail, CommitFileChange, CommitResult, DiffResult,
} from "@/features/git/types";
import type { AuthMethod } from "@/features/connection/types";
import type { FileNode, FileContent } from "@/features/file/types";

export interface LocalConnectionContext {
  type: "local";
  projectId: string;
}

export interface WslConnectionContext {
  type: "wsl";
  distro: string;
  projectPath: string;
}

export interface RemoteConnectionContext {
  type: "remote";
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  projectPath: string;
}

export type ConnectionContext =
  | LocalConnectionContext
  | WslConnectionContext
  | RemoteConnectionContext;

export interface UnifiedProjectView {
  readonly type: ProjectType;
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly gitInfo: GitInfo | null;
  readonly selectedAgent: string | null;
  readonly selectedIde: string | null;
}

export interface ProjectCommands {
  refreshGitInfo(): Promise<GitInfo>;
  getAheadBehind(): Promise<AheadBehind>;
  getChangedFilesDiffStats(): Promise<Array<{ path: string; additions: number; deletions: number }>>;
  getFileDiff(filePath: string): Promise<DiffResult>;
  stageFiles(filePaths: string[]): Promise<void>;
  unstageFiles(filePaths: string[]): Promise<void>;
  discardFile(filePath: string): Promise<void>;
  commitFiles(filePaths: string[], message: string): Promise<CommitResult>;
  fetch(): Promise<void>;
  pull(): Promise<void>;
  push(setUpstream?: boolean): Promise<void>;
  checkoutBranch(branchName: string): Promise<void>;
  createBranch(branchName: string, startPoint?: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;
  getCommitLog(count: number, skip?: number): Promise<CommitEntry[]>;
  getCommitDetail(commitHash: string): Promise<CommitDetail>;
  getCommitFiles(commitHash: string): Promise<CommitFileChange[]>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;
  cherryPick(commitHash: string): Promise<void>;
  revert(commitHash: string): Promise<void>;
  createTag(tagName: string, message?: string): Promise<void>;
  readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]>;
  readFileContent(filePath: string, rootPath?: string): Promise<FileContent>;
  writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void>;
  generateCommitMessage(agentId: string, filePaths: string[], agentCommandOverride?: string | null): Promise<string>;
}

export interface ProjectCapabilities {
  canCommit: boolean;
  canPush: boolean;
  canPull: boolean;
  canFetch: boolean;
  canStage: boolean;
  canDiscard: boolean;
  canViewLog: boolean;
  canCherryPick: boolean;
  canRevert: boolean;
  canCreateTag: boolean;
  canBrowseFiles: boolean;
  canEditFiles: boolean;
  canGenerateCommitMessage: boolean;
  canManagePRs: boolean;
}

export interface ActiveProjectContext {
  project: UnifiedProjectView | null;
  commands: ProjectCommands | null;
  capabilities: ProjectCapabilities | null;
  connectionContext: ConnectionContext | null;
  worktreePath: string | null;
  isLoading: boolean;
}
