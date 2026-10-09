import type { AgentConfig } from '@/shared/types/agent';
import type { AuthMethod } from '@/shared/types/connection';
import type {
  AheadBehind,
  CommitDetail,
  CommitEntry,
  CommitFileChange,
  CommitResult,
  DiffResult,
  GitInfo,
  GitStatusSnapshot,
  PushOutcome,
  StashActionResult,
  StashEntry,
} from '@/shared/types/git';

export type ProjectEnvironment =
  | { type: 'Local' }
  | { type: 'Wsl'; distro: string }
  | { type: 'Remote'; host: string; port: number; username: string; auth: AuthMethod };

export function environmentToConnectionContext(
  env: ProjectEnvironment,
  projectPath: string,
  projectId: string,
): ConnectionContext {
  switch (env.type) {
    case 'Local':
      return { type: 'local', projectId };
    case 'Wsl':
      return { type: 'wsl', distro: env.distro, projectPath };
    case 'Remote':
      return {
        type: 'remote',
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
    status: 'Idle' | 'Running' | 'Failed';
    history: string[];
    agent: AgentConfig | null;
  };
  selected_agents: string[];
  selected_ide: string | null;
  active_view: 'Terminal' | { Diff: { file_path: string } };
  collapsed: boolean;
  avatar_color?: string | null;
  /** Project-level primary LSP language override (e.g. "go", "rust"). null = auto. */
  primary_language?: string | null;
}

export type TerminalEntry = {
  project: Project;
};

export interface LocalConnectionContext {
  type: 'local';
  projectId: string;
}

export interface WslConnectionContext {
  type: 'wsl';
  distro: string;
  projectPath: string;
}

export interface RemoteConnectionContext {
  type: 'remote';
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
  /** 读取**本命令所属Workspace**（主仓或该 worktree）的权威 status */
  refreshWorkspaceStatus(): Promise<GitStatusSnapshot>;
  getAheadBehind(): Promise<AheadBehind>;
  getChangedFilesDiffStats(): Promise<
    Array<{ path: string; additions: number; deletions: number }>
  >;
  getFileDiff(filePath: string, collapse?: boolean): Promise<DiffResult>;
  /** 展开折叠的 untracked 目录条目：列出目录下的 untracked 文件（changes list 按需调用） */
  listUntrackedFiles(dirPath: string): Promise<string[]>;
  stageFiles(filePaths: string[]): Promise<void>;
  unstageFiles(filePaths: string[]): Promise<void>;
  /**
   * 丢弃一批文件的变更（唯一入口）。
   *
   * 路径集合由调用方决定（单行 / 选中 / 整组）；每条路径是删除（未跟踪）
   * 还是恢复（已跟踪）由仓库状态决定，不由前端声明 —— 保证确认文案与执行范围一致。
   */
  discardFiles(filePaths: string[]): Promise<void>;
  /**
   * 长操作可带 `consoleRunId`：非空时后端把 stdout/stderr 以
   * `git-operation-output` 事件实时推给 Console（落点见 `useGitConsoleBridge`）。
   */
  commitFiles(
    filePaths: string[],
    message: string,
    consoleRunId?: string | null,
  ): Promise<CommitResult>;
  fetch(consoleRunId?: string | null): Promise<PushOutcome>;
  pull(consoleRunId?: string | null): Promise<PushOutcome>;
  push(setUpstream?: boolean, consoleRunId?: string | null): Promise<PushOutcome>;
  fetchWithCredentials(
    username: string,
    password: string,
    consoleRunId?: string | null,
  ): Promise<PushOutcome>;
  pullWithCredentials(
    username: string,
    password: string,
    consoleRunId?: string | null,
  ): Promise<PushOutcome>;
  pushWithCredentials(
    setUpstream: boolean,
    username: string,
    password: string,
    consoleRunId?: string | null,
  ): Promise<PushOutcome>;
  checkoutBranch(branchName: string): Promise<void>;
  createBranch(branchName: string, startPoint?: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;
  getCommitLog(count: number, skip?: number): Promise<CommitEntry[]>;
  getCommitDetail(commitHash: string): Promise<CommitDetail>;
  getCommitFiles(commitHash: string): Promise<CommitFileChange[]>;
  getStashList(): Promise<StashEntry[]>;
  getStashFiles(selector: string): Promise<CommitFileChange[]>;
  getStashFileDiff(selector: string, filePath: string, collapse?: boolean): Promise<DiffResult>;
  stashApply(selector: string): Promise<StashActionResult>;
  stashPop(selector: string): Promise<StashActionResult>;
  getCommitFileDiff(commitHash: string, filePath: string, collapse?: boolean): Promise<DiffResult>;
  cherryPick(commitHash: string): Promise<void>;
  revert(commitHash: string): Promise<void>;
  createTag(tagName: string, message?: string): Promise<void>;
  generateCommitMessage(
    agentId: string,
    filePaths: string[],
    agentCommandOverride?: string | null,
  ): Promise<string>;
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
