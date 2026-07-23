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

export type TaskRunStatus = "running" | "idle" | "failed";

/**
 * One task *run* shown as a tab in the bottom Console panel.
 *
 * Lifecycle is owned by the task domain (process + output buffer), not by
 * whether the Console panel is mounted. Hide/show only toggles visibility.
 */
export interface TaskRun {
  id: string;
  projectId: string;
  projectPath: string;
  configId: string;
  /** Tab label — task name. */
  name: string;
  command: string;
  status: TaskRunStatus;
  /** Backend process/PTY id while running; null after exit or stop. */
  processId: string | null;
  /** Accumulated ANSI/plain output for the output console. */
  output: string;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

/** @deprecated Use TaskRun — Console is an output view over runs, not a PTY host. */
export type TaskConsoleSession = TaskRun;

/** @deprecated Prefer TaskRun — kept for residual imports. */
export interface TaskState {
  status: "idle" | "running";
  activeConfigId: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
}
