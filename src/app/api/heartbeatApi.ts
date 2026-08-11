// eslint-disable-next-line no-restricted-imports -- app-level IPC wrapper; the single sanctioned invoke site for heartbeat
import { invoke } from '@tauri-apps/api/core';

/**
 * Report renderer liveness to the Rust backend.
 *
 * The backend's heartbeat monitor uses this to tell a crashed / frozen
 * WebView apart from a healthy one, and auto-reloads the window to recover
 * from a black screen. Best-effort: failures are swallowed by callers.
 */
export function heartbeat(): Promise<void> {
  return invoke('heartbeat');
}
