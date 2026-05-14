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
  /** Tab ID of the running task terminal */
  sessionId: string | null;
  /** PTY session ID (written back by terminalFactory after session creation) */
  ptySessionId: string | null;
}
