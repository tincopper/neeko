export interface TaskConfig {
  id: string;
  name: string;
  command: string;
  scope: "project" | "app";
  project_id?: string;
}

/** Auto-discovered runnable (not persisted until imported). camelCase from Rust. */
export interface DiscoveredTask {
  id: string;
  name: string;
  command: string;
  source: string;
  group: string;
  description?: string | null;
  priority: number;
}

export interface TaskState {
  status: "idle" | "running";
  activeConfigId: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
}
