/**
 * Mutual exclusion for bottom islands (Task Console vs Debug).
 * Stores register closers at module init; open paths call exclusiveOpen*.
 * Avoids circular zustand imports between task and debug stores.
 */

type Closer = () => void;

let closeConsole: Closer | null = null;
let closeDebug: Closer | null = null;

export function registerTaskConsoleCloser(fn: Closer) {
  closeConsole = fn;
}

export function registerDebugPanelCloser(fn: Closer) {
  closeDebug = fn;
}

/** Call before showing the Debug panel. */
export function exclusiveOpenDebugPanel() {
  closeConsole?.();
}

/** Call before showing the Task Console panel. */
export function exclusiveOpenTaskConsole() {
  closeDebug?.();
}
