// eslint-disable-next-line no-restricted-imports -- app-level IPC wrapper; the single sanctioned invoke site for frontend error reporting
import { invoke } from '@tauri-apps/api/core';

export interface FrontendErrorPayload {
  source: string;
  message: string;
  stack?: string | null;
}

/**
 * Report a frontend error to the Rust file logger (`~/.neeko/neeko.log`).
 * Best-effort: failures are swallowed by callers (the error path must never
 * crash again).
 */
export function logFrontendError(payload: FrontendErrorPayload): Promise<void> {
  return invoke('log_frontend_error', {
    source: payload.source,
    message: payload.message,
    stack: payload.stack ?? null,
  });
}
