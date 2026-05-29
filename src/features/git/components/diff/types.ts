import type { AuthMethod } from "../../../../types";

export interface DiffLine {
  Context?: string;
  Added?: string;
  Removed?: string;
  Collapsed?: string;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  truncated?: boolean;
}

export type ViewMode = "unified" | "split";

export type DiffSource =
  | { type: "local"; projectId: string }
  | { type: "wsl"; distro: string; projectPath: string }
  | {
      type: "remote";
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
    }
  | { type: "worktree"; projectId: string; worktreePath: string }
  | { type: "commit"; projectId: string; commitHash: string }
  | { type: "wsl-commit"; distro: string; projectPath: string; commitHash: string }
  | {
      type: "remote-commit";
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      commitHash: string;
    };

export interface DiffViewProps {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
  initialMode?: ViewMode;
  onBack?: () => void;
}

export interface SplitRow {
  type: "hunk-header" | "change" | "context";
  hunkHeader?: string;
  oldLineNum?: number;
  newLineNum?: number;
  oldContent?: string;
  newContent?: string;
  oldType?: "removed" | "context" | "empty";
  newType?: "added" | "context" | "empty";
}
