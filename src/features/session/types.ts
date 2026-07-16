import type { ProjectEnvironment } from "@/features/project/types";

export interface ProjectSessionData {
  id: string;
  name: string;
  path: string;
  environment: ProjectEnvironment;
  selected_agent: string | null;
  selected_ide: string | null;
  terminal_history: string[];
  last_status: string;
  collapsed: boolean;
  avatar_color?: string | null;
}

export interface SessionStore {
  projects: ProjectSessionData[];
  active_project_id: string | null;
  last_updated: string;
  sidebar_width: number | null;
  worktree_state: Record<string, string>;
}
