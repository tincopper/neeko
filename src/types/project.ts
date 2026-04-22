import type { AgentConfig } from "./agent";
import type { WSLProject, RemoteProject } from "./connection";
import type { GitInfo } from "./git";

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
