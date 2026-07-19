/**
 * Stack-frame helpers for DAP stopped handling:
 * prefer user-project sources over runtime / stdlib (Just My Code, light).
 */
import type { StackFrameDto } from './types';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Paths that are almost never "your code" in a debug stop.
 * Prefer GOROOT / module-cache / Rust sysroot patterns — avoid bare
 * `/src/os/` which can match project packages.
 */
export function isSystemDebugSource(sourcePath: string | null | undefined): boolean {
  if (!sourcePath) return true;
  const p = normalizePath(sourcePath).toLowerCase();
  if (!p) return true;

  // Go module cache (deps)
  if (p.includes('/pkg/mod/')) return true;
  if (p.includes('/go/pkg/mod/')) return true;

  // GOROOT stdlib: /usr/local/go/src/..., /opt/homebrew/opt/go/libexec/src/...
  // Match ".../go/src/<stdlib pkg>/..." but not GOPATH-style github.com trees.
  if (/\/go\/src\/(runtime|internal|syscall|reflect|sync|os|fmt|time|net|crypto|context|errors|strings|bytes|io|unicode|math|sort|strconv|path|encoding|testing|unsafe|builtin)\//.test(p)) {
    return true;
  }
  // libexec layout (Homebrew)
  if (/\/libexec\/src\/(runtime|internal|syscall)\//.test(p)) {
    return true;
  }
  // Windows-ish: C:/Go/src/runtime/
  if (/\/go\/src\/runtime\//.test(p) || /\\go\\src\\runtime\\/.test(sourcePath.toLowerCase())) {
    return true;
  }

  // Rust sysroot / crates.io
  if (p.includes('/rustc/') && p.includes('/library/')) return true;
  if (p.includes('/lib/rustlib/src/rust/')) return true;
  if (p.includes('/.rustup/toolchains/')) return true;
  if (p.includes('/registry/src/')) return true;

  return false;
}

/** Frame belongs to the open project (path under project root). */
export function isUserProjectFrame(
  frame: StackFrameDto,
  projectPath: string | null | undefined,
): boolean {
  const src = frame.sourcePath;
  if (!src || isSystemDebugSource(src)) return false;
  const proj = projectPath ? normalizePath(projectPath) : '';
  if (!proj) {
    // No project path: treat non-system as user code.
    return true;
  }
  const file = normalizePath(src);
  return file === proj || file.startsWith(proj + '/');
}

/**
 * Choose which frame drives yellow-line + auto-open.
 * 1) First frame under projectPath and not system
 * 2) Else first non-system path (handles empty/mismatched projectPath)
 * 3) Else null — caller may auto-continue (Just My Code)
 */
export function pickNavigateFrame(
  frames: StackFrameDto[],
  projectPath: string | null | undefined,
): StackFrameDto | null {
  if (!frames.length) return null;
  for (const f of frames) {
    if (isUserProjectFrame(f, projectPath)) return f;
  }
  for (const f of frames) {
    if (f.sourcePath && !isSystemDebugSource(f.sourcePath)) return f;
  }
  return null;
}

/** Whether any frame is navigable user code. */
export function hasUserProjectFrame(
  frames: StackFrameDto[],
  projectPath: string | null | undefined,
): boolean {
  return pickNavigateFrame(frames, projectPath) != null;
}

/**
 * When true, FE should auto-`continue` instead of parking on runtime/stdlib.
 * Skips user intentional pause; only when there is no navigable user frame.
 */
export function shouldAutoContinueSystemStop(
  frames: StackFrameDto[],
  projectPath: string | null | undefined,
  stopReason: string | null | undefined,
): boolean {
  const reason = (stopReason ?? '').toLowerCase();
  // User clicked Pause — do not skip.
  if (reason === 'pause') return false;
  if (!frames.length) return false;
  return pickNavigateFrame(frames, projectPath) == null;
}
