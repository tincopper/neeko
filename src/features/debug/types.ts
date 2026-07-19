export interface LaunchConfig {
  name: string;
  type: string;
  request: string;
  program?: string | null;
  cwd?: string | null;
  args?: string[];
  mode?: string | null;
  /** Shell command run before launch (e.g. cargo build). */
  preLaunchTask?: string | null;
  /** Pause at program entry (default false — only user breakpoints). */
  stopOnEntry?: boolean | null;
}

/** Discovered app entry (Go main package / Rust binary). */
export interface EntryPoint {
  id: string;
  name: string;
  language: string;
  program: string;
  programTemplate: string;
  runCommand: string;
  configName: string;
  adapterType: string;
  mode?: string | null;
  preLaunchTask?: string | null;
}

export interface DapSessionInfo {
  sessionId: string;
  projectId: string;
  projectPath: string;
  configName: string;
  status: string;
  statusMessage?: string | null;
}

export interface BreakpointSpec {
  filePath: string;
  line: number;
  verified?: boolean;
}

export interface StackFrameDto {
  id: number;
  name: string;
  sourcePath?: string | null;
  line: number;
  column: number;
}

export interface VariableDto {
  name: string;
  value: string;
  type?: string | null;
  variablesReference: number;
}

export interface DapEventPayload {
  sessionId: string;
  projectId: string;
  kind: string;
  body: unknown;
}

export interface ConsoleLine {
  id: string;
  kind: 'in' | 'out' | 'err' | 'sys';
  text: string;
}

/** Which pane is focused in the bottom debug panel. */
export type DebugPanelTab = 'session' | 'console' | 'breakpoints';
