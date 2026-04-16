// Skill navigation views
export type SkillView = "local" | "marketplace" | "project" | "tools";

// App configuration (persisted)
export type DiffMode = "unified" | "split";
export type AppTheme = "dark" | "light" | "one-dark-pro" | "claude";

export interface AppConfig {
  theme: AppTheme;
  appearanceFontSize: number;  // UI �������壨��������ļ�����Tab �ȣ�
  editorFontSize: number;      // �༭�����壨CodeMirror / FileViewer��
  terminalFontSize: number;    // �ն����壨xterm.js + �ն� Tab��
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

// WSL ���а���Ŀ
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

// WSL ���а� (�־û�)
export interface WSLEntrySession {
  id: string;
  distro: string;
  projects: WSLProject[];
}

// SSH Զ����Ŀ
export interface RemoteProject {
  id: string;
  name: string;
  path: string;
  entry_id: string;
  selected_agent: string | null;
  selected_ide: string | null;
  git_info?: GitInfo | null;
}

// SSH ��֤��ʽ
export type AuthMethod =
  | { Password: string }
  | { KeyFile: string }
  | { KeyFileWithPassphrase: { key_path: string; passphrase: string } };

// SSH Զ�̷����� (�־û�)
export interface RemoteEntrySession {
  id: string;
  host: string;
  port: number;
  username: string;
  projects: RemoteProject[];
  saved_auth?: string | null;
}

// ͳһ���ն���Ŀ����
export type TerminalEntry =
  | { type: 'local'; project: Project }
  | { type: 'wsl'; distro: string; project: WSLProject }
  | { type: 'remote'; host: string; project: RemoteProject };

// ͳһ��Ŀ����
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

// �־û��Ự�洢���� Rust SessionStore ��Ӧ��
export interface SessionStore {
  projects: { id: string; name: string; path: string; selected_agent: string | null; selected_ide: string | null; terminal_history: string[]; last_status: string; collapsed: boolean }[];
  active_project_id: string | null;
  last_updated: string;
  wsl_entries: WSLEntrySession[];
  remote_entries: RemoteEntrySession[];
  sidebar_width: number | null;
  side_terminal_width: number | null;
  worktree_state: Record<string, string>;
}

// �ļ����ڵ㣨Ŀ¼���������ͣ�
export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

// �ļ����ݣ���ȡ�ļ��������ͣ�
export interface FileContent {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
}

// �ļ���ͼ״̬
export interface FileViewState {
  projectId: string;
  filePath: string;
}

// �ļ���ǩҳ
export interface FileTab {
  id: string;           // unique id: projectId:filePath
  projectId: string;
  filePath: string;
  fileName: string;     // display name
  content: FileContent;
  isDirty: boolean;
  order: number;
}

// ������ Skill Management Types ��������������������������������������������������������������������������������

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

/** A tag group (e.g. "���ʦ", "��˼ܹ�ʦ"). */
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