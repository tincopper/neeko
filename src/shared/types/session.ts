import type { ProjectEnvironment } from '@/shared/types/project';

export interface ConversationMeta {
  id: string;
  nativeSessionId: string;
  agentId: string;
  title: string;
  model?: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  filePath: string;
  projectPath: string | null;
  userTitle: string | null;
  tags: string[];
  /**
   * Whether native resume is available.
   * Backend always sends a boolean; UI shows Resume only when `true`.
   * Optional for older/mock payloads — treat missing as not supported.
   */
  supportsResume?: boolean;
  /**
   * 删除能力三态（后端扫描期写入，UI 不额外查询）。
   *
   * - `native`：委派 agent 自己的 CLI（它维护索引 / 子会话）；
   * - `storage`：Neeko 删这条会话独占的存储（文件 / 目录 / 文件对）；
   * - `unsupported`：无安全删除路径 → **不显示删除入口**（宁缺不错）。
   *
   * 缺失（旧载荷 / 旧磁盘索引）按 `unsupported` 处理。
   */
  deleteSupport?: ConversationDeleteSupport;
}

/** 删除能力三态（与 Rust `SessionDeleteSupport` 的 snake_case 序列化同形）。 */
export type ConversationDeleteSupport = 'native' | 'storage' | 'unsupported';

export interface ProjectSessionData {
  id: string;
  name: string;
  path: string;
  environment: ProjectEnvironment;
  selected_agents: string[];
  selected_ide: string | null;
  terminal_history: string[];
  last_status: string;
  collapsed: boolean;
  avatar_color?: string | null;
  /** Project-level primary LSP language override. */
  primary_language?: string | null;
}

export interface SessionStore {
  projects: ProjectSessionData[];
  active_project_id: string | null;
  last_updated: string;
  sidebar_width: number | null;
  worktree_state: Record<string, string>;
}
