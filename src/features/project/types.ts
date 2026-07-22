import type { AgentConfig } from "@/features/agent/types";
import type { GitInfo, PushOutcome } from "@/features/git/types";

export type ProjectEnvironment =
  | { type: "Local" }
  | { type: "Wsl"; distro: string }
  | { type: "Remote"; host: string; port: number; username: string; auth: AuthMethod };

export function environmentToConnectionContext(
  env: ProjectEnvironment,
  projectPath: string,
  projectId: string,
): ConnectionContext {
  switch (env.type) {
    case "Local":
      return { type: "local", projectId };
    case "Wsl":
      return { type: "wsl", distro: env.distro, projectPath };
    case "Remote":
      return {
        type: "remote",
        host: env.host,
        port: env.port,
        username: env.username,
        auth: env.auth,
        projectPath,
      };
  }
}

export interface Project {
  id: string;
  name: string;
  path: string;
  environment: ProjectEnvironment;
  git_info: GitInfo | null;
  terminal: {
    id: string;
    pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[];
    agent: AgentConfig | null;
  };
  selected_agents: string[];
  selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
  avatar_color?: string | null;
  /** Project-level primary LSP language override (e.g. "go", "rust"). null = auto. */
  primary_language?: string | null;
}

export type TerminalEntry = {
  project: Project;
};

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

export interface ProjectView {
  readonly type: ProjectEnvironment['type'];
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly gitInfo: GitInfo | null;
  readonly selectedAgent: string[];
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
  fetch(): Promise<PushOutcome>;
  pull(): Promise<PushOutcome>;
  push(setUpstream?: boolean): Promise<PushOutcome>;
  fetchWithCredentials(username: string, password: string): Promise<PushOutcome>;
  pullWithCredentials(username: string, password: string): Promise<PushOutcome>;
  pushWithCredentials(setUpstream: boolean, username: string, password: string): Promise<PushOutcome>;
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
  project: ProjectView | null;
  commands: ProjectCommands | null;
  capabilities: ProjectCapabilities | null;
  connectionContext: ConnectionContext | null;
  worktreePath: string | null;
  isLoading: boolean;
}
