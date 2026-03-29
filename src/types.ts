// App configuration (persisted)
export type DiffMode = "unified" | "split";

export interface AppConfig {
  fontSize: number;
  diffMode: DiffMode;
  shell: string;
  fontFamily: string;
  customIdes: { name: string; command: string }[];
  ideCommandOverrides: Record<string, string>;
  agentCommandOverrides: Record<string, string>;
  customAgents: AgentConfig[];
}

export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
  additions: number;
  deletions: number;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
}

export interface GitInfo {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
  changed_files: FileChange[];
  is_clean: boolean;
}

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
    agent: any;
  };
  selected_agent: string | null;
  selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed?: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  icon: string | null;
  enabled: boolean;
}

// WSL 发行版项目
export interface WSLProject {
  id: string;
  name: string;
  path: string;
  distro: string;
  entry_id: string;
  selected_agent: string | null;
  selected_ide: string | null;
  git_info?: GitInfo | null;
}

// WSL 发行版 (持久化)
export interface WSLEntrySession {
  id: string;
  distro: string;
  projects: WSLProject[];
}

// SSH 远程项目
export interface RemoteProject {
  id: string;
  name: string;
  path: string;
  entry_id: string;
  selected_agent: string | null;
  selected_ide: string | null;
  git_info?: GitInfo | null;
}

// SSH 认证方式
export type AuthMethod =
  | { Password: string }
  | { KeyFile: string }
  | { KeyFileWithPassphrase: { key_path: string; passphrase: string } };

// SSH 远程服务器 (持久化)
export interface RemoteEntrySession {
  id: string;
  host: string;
  port: number;
  username: string;
  projects: RemoteProject[];
  saved_auth?: string | null;
}

// 统一的终端项目类型
export type TerminalEntry =
  | { type: 'local'; project: Project }
  | { type: 'wsl'; distro: string; project: WSLProject }
  | { type: 'remote'; host: string; project: RemoteProject };
