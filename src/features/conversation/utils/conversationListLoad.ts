/**
 * Conversation list load policy helpers (fishbone / SWR).
 *
 * Kept pure so hooks stay thin and unit-testable without React.
 */

/** Min interval between automatic background scans for the same project key. */
export const AUTO_SCAN_THROTTLE_MS = 5_000;

export type ListLoadPhase = 'idle' | 'hydrating' | 'refreshing' | 'ready' | 'error';

export interface ListLoadState {
  /** True only when we have no rows yet and are waiting on the first hydrate. */
  loading: boolean;
  /** True while a background scan (or forced refresh) is in flight. */
  refreshing: boolean;
  /** Soft error from the last failed scan/list; does not clear rows. */
  error: string | null;
}

export function initialListLoadState(): ListLoadState {
  return { loading: false, refreshing: false, error: null };
}

/** Build a stable key for throttle / in-flight de-dupe. */
export function listLoadKey(projectPath: string | null, agentFilter?: string): string {
  return `${projectPath ?? ''}::${agentFilter ?? ''}`;
}

/**
 * Whether an automatic background scan should run.
 * Manual refresh always bypasses this (caller passes force=true upstream).
 */
export function shouldAutoScan(lastScanAt: number | undefined, now: number, throttleMs = AUTO_SCAN_THROTTLE_MS): boolean {
  if (lastScanAt == null) return true;
  return now - lastScanAt >= throttleMs;
}

/** Prefer keeping existing rows when a soft failure happens. */
export function resolveListAfterError<T>(previous: T[], fallbackEmpty: boolean): T[] {
  if (previous.length > 0) return previous;
  return fallbackEmpty ? [] : previous;
}
