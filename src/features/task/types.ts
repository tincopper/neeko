export interface TaskConfig {
  id: string;
  name: string;
  command: string;
  scope: "project" | "app";
  project_id?: string;
}

export interface TaskState {
  status: "idle" | "running";
  activeConfigId: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
}
