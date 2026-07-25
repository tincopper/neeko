import type { CommitFileChange } from "./types";

/** Split a file path into basename + directory. */
export function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return { name: filePath, dir: "" };
  return {
    name: normalized.slice(idx + 1) || filePath,
    dir: normalized.slice(0, idx),
  };
}

/** Stable DOM id for combined file sections (scrollToPath target). */
export function fileBlockId(filePath: string): string {
  return `fileblock-${filePath.replace(/[/\\]/g, "_")}`;
}

/** Map git status letter / word to a single badge letter. */
export function statusLetter(status: string): string {
  const s = status.trim();
  if (!s) return "M";
  const upper = s.toUpperCase();
  if (upper === "M" || upper.startsWith("MOD")) return "M";
  if (upper === "A" || upper.startsWith("ADD")) return "A";
  if (upper === "D" || upper.startsWith("DEL")) return "D";
  if (upper === "R" || upper.startsWith("REN")) return "R";
  return upper[0] ?? "M";
}

export function statusBadgeClass(letter: string): string {
  switch (letter) {
    case "A":
      return "text-accent-green bg-accent-green/15";
    case "D":
      return "text-accent-red bg-accent-red/15";
    case "R":
      return "text-accent-yellow bg-accent-yellow/15";
    case "M":
    default:
      return "text-accent-blue bg-accent-blue/15";
  }
}

export function sumFileStats(files: CommitFileChange[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/**
 * Default expanded paths for combined mode (PRD R2.4):
 * - ≤3 files: all expanded
 * - otherwise: only preferred (scrollToPath) or first file
 */
export function initialExpandedPaths(
  files: CommitFileChange[],
  preferredPath?: string | null,
): Set<string> {
  if (files.length === 0) return new Set();
  if (files.length <= 3) return new Set(files.map((f) => f.path));
  const preferred =
    preferredPath && files.some((f) => f.path === preferredPath)
      ? preferredPath
      : files[0].path;
  return new Set([preferred]);
}

export function indexOfPath(files: CommitFileChange[], path: string | null | undefined): number {
  if (!path) return -1;
  return files.findIndex((f) => f.path === path);
}
