/**
 * Client-side mirrors of the clone-form pure helpers in
 * `src-tauri/src/project/clone.rs` (authoritative: the Rust side re-validates
 * everything; these exist for instant inline feedback in the dialog).
 */

/** Derive a project name from a git URL (strip trailing `/`, `.git`, take last segment). */
export function deriveProjectName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const withoutSuffix = trimmed.endsWith('.git') ? trimmed.slice(0, -4) : trimmed;
  const lastSegment = withoutSuffix.split('/').pop() ?? '';
  const colonIdx = lastSegment.lastIndexOf(':');
  return colonIdx >= 0 ? lastSegment.slice(colonIdx + 1) : lastSegment;
}

/** Validate a clone URL scheme (http/https/git@ only). */
export function isValidCloneUrl(url: string): boolean {
  return /^https?:\/\//.test(url) || url.startsWith('git@');
}

/** Sanitize a project name: allowlist `[A-Za-z0-9._-]`, others become `-`. */
export function sanitizeProjectName(raw: string): string {
  return raw.trim().replace(/[^A-Za-z0-9._-]/g, '-');
}
