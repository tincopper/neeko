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
}

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
