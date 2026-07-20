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

/** One task run shown as a tab in the bottom Console panel. */
export interface TaskConsoleSession {
  id: string;
  projectId: string;
  projectPath: string;
  configId: string;
  /** Tab label — task name. */
  name: string;
  command: string;
  status: "running" | "idle" | "failed";
  ptySessionId: string | null;
  /** Bump to force terminal remount / re-run. */
  rebuildKey: number;
}

/** @deprecated Prefer TaskConsoleSession — kept for any residual imports. */
export interface TaskState {
  status: "idle" | "running";
  activeConfigId: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
}
