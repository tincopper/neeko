/**
 * Tauri event names used by the terminal/task features.
 * Keep in sync with `src-tauri/src/common/terminal/events.rs`.
 */
export const TERMINAL_INPUT_EVENT = 'terminal-input';
export const TERMINAL_OUTPUT_EVENT = 'terminal-output';
export const TERMINAL_CLOSED_EVENT = 'terminal-closed';
/** Zero-payload wake hint: buffered output exists, pull via `terminal_drain`. */
export const TERMINAL_DRAIN_EVENT = 'terminal-drain';

export function terminalInputEvent(sessionId: string): string {
  return `${TERMINAL_INPUT_EVENT}-${sessionId}`;
}

export function terminalOutputEvent(sessionId: string): string {
  return `${TERMINAL_OUTPUT_EVENT}-${sessionId}`;
}

export function terminalClosedEvent(sessionId: string): string {
  return `${TERMINAL_CLOSED_EVENT}-${sessionId}`;
}

export function terminalDrainEvent(sessionId: string): string {
  return `${TERMINAL_DRAIN_EVENT}-${sessionId}`;
}
