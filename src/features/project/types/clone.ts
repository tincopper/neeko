/**
 * Clone progress IPC payload — mirrors `CloneProgressEvent` in
 * `src-tauri/src/project/events.rs` (snake_case wire format).
 */
export interface CloneProgress {
  clone_id: string;
  phase: string;
  percent: number;
  message: string;
}

export type ClonePhase = 'counting' | 'compressing' | 'receiving' | 'resolving' | 'updating';

/** Params for `clone_git_project`. */
export interface CloneProjectParams {
  url: string;
  destParent: string;
  name: string;
}

/** Result of `clone_git_project` — path to feed into the add-project chain. */
export interface CloneProjectResult {
  path: string;
}
