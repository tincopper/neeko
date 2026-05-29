/**
 * Wraps a promise with a timeout. If the promise does not resolve within
 * `ms` milliseconds, the returned promise rejects with an error message that
 * includes the optional `label` for easier debugging.
 *
 * This is useful for IPC calls that may block indefinitely when the Rust
 * backend's project_manager Mutex is held by a long-running operation (e.g.
 * git fetch/push/pull). Without a timeout, `loading` state stays true
 * forever and the UI remains frozen.
 *
 * Usage:
 *   const result = await withTimeout(invoke('git_fetch'), 60_000, 'fetch');
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(
        new Error(
          `Operation timed out after ${ms / 1000}s${label ? ` (${label})` : ""}`,
        ),
      );
    }, ms);
  });
  return Promise.race([promise, timeout]);
}
