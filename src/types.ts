// Skill navigation views
export type SkillView = "local" | "marketplace" | "project" | "tools";

// App configuration (persisted)
export type DiffMode = "unified" | "split";
export type AppTheme = "dark" | "light" | "one-dark-pro" | "claude";

export interface AppConfig {
  theme: AppTheme;
  appearanceFontSize: number;  // UI 整体字体（侧边栏、文件树、Tab 等）
  editorFontSize: number;      // 编辑器字体（CodeMirror / FileViewer）
  terminalFontSize: number;    // 终端字体（xterm.js + 终端 Tab）
  diffMode: DiffMode;
  shell: string;
  fontFamily: string;
  customIdes: { name: string; command: string }[];
  ideCommandOverrides: Record<string, string>;
  agentCommandOverrides: Record<string, string>;
  customAgents: AgentConfig[];
  agentSelectorShowPresetBar: boolean;
  agentSelectorCompactMode: boolean;
  hiddenAgentIds: string[];
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
    agent: AgentConfig | null;
  };
  selected_agent: string | null;
  selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
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

// 统一项目类型
export type ProjectType = 'local' | 'wsl' | 'remote';

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

export interface WslProjectAdapter {
  type: 'wsl';
  distro: string;
  project: UnifiedProject;
}

export interface RemoteProjectAdapter {
  type: 'remote';
  entry: RemoteEntrySession;
  project: UnifiedProject;
}

export type ActiveProjectAdapter = 
  | { type: 'local'; project: UnifiedProject }
  | WslProjectAdapter 
  | RemoteProjectAdapter;

// Terminal Tab
export interface TerminalTab {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string;
  status: "Idle" | "Running" | "Failed";
  order: number;
}

export type PaneId = string;
export type PaneDirection = "horizontal" | "vertical";
export type SplitPathStep = "first" | "second";

export type PaneNode =
  | { type: "leaf"; paneId: PaneId }
  | {
      type: "split";
      direction: PaneDirection;
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

export interface SplitState {
  root: PaneNode;
  activePaneId: PaneId;
  paneCount: number;
}


// 持久化会话存储（与 Rust SessionStore 对应）
export interface SessionStore {
  projects: { id: string; name: string; path: string; selected_agent: string | null; selected_ide: string | null; terminal_history: string[]; last_status: string; collapsed: boolean }[];
  active_project_id: string | null;
  last_updated: string;
  wsl_entries: WSLEntrySession[];
  remote_entries: RemoteEntrySession[];
  sidebar_width: number | null;
  worktree_state: Record<string, string>;
}

// 文件树节点（目录树返回类型）
export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

// 文件内容（读取文件返回类型）
export interface FileContent {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
}

// 文件视图状态
export interface FileViewState {
  projectId: string;
  filePath: string;
}

// 文件标签页
export interface FileTab {
  id: string;           // unique id: projectId:filePath
  projectId: string;
  filePath: string;
  fileName: string;     // display name
  content: FileContent;
  isDirty: boolean;
  order: number;
}

// ─── Skill Management Types ────────────────────────────────────────

/** A managed skill record (mirrors Rust SkillRecord). */
export interface SkillRecord {
  id: string;
  name: string;
  description: string | null;
  source_type: "local" | "git";
  source_ref: string | null;
  central_path: string;
  content_hash: string | null;
  enabled: boolean;
  status: string;
  update_status: "up_to_date" | "update_available" | "unknown";
  tags: string[];
  created_at: number;
  updated_at: number;
}

/** Managed skill DTO returned by get_managed_skills command. */
export interface ManagedSkillDto {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_ref: string | null;
  central_path: string;
  enabled: boolean;
  status: string;
  update_status: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}

/** Agent tool info for skill deployment. */
export interface ToolInfo {
  key: string;
  display_name: string;
  installed: boolean;
  has_override: boolean;
  is_custom: boolean;
}

/** A tag group (e.g. "设计师", "后端架构师"). */
export interface TagGroup {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  skill_count: number;
}

/** A skill target deployment record. */
export interface SkillTargetRecord {
  id: string;
  skill_id: string;
  tool: string;
  target_path: string;
  mode: "symlink" | "copy";
  status: string;
  synced_at: number | null;
}

/** Per-skill per-tool toggle within a tag group. */
export interface SkillToolToggle {
  tool: string;
  display_name: string;
  enabled: boolean;
  installed: boolean;
}

/** Skill document content. */
export interface SkillDocumentDto {
  content: string;
}
