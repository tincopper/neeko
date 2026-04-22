import type { RemoteEntrySession, WSLEntrySession } from "./connection";

export interface SessionStore {
  projects: {
    id: string;
    name: string;
    path: string;
    selected_agent: string | null;
    selected_ide: string | null;
    terminal_history: string[];
    last_status: string;
    collapsed: boolean;
  }[];
  active_project_id: string | null;
  last_updated: string;
  wsl_entries: WSLEntrySession[];
  remote_entries: RemoteEntrySession[];
  sidebar_width: number | null;
  worktree_state: Record<string, string>;
}
