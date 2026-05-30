import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "../components/terminalInput";

export interface CacheEntry {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

export interface TerminalStrategy {
  kind: "local" | "wsl" | "remote";
  cacheKey: string;
  cache: Map<string, CacheEntry>;
  rebuildCallbacks: Map<string, () => void>;
  wrapperRefs: Map<string, HTMLDivElement>;
  createSession: (cols: number, rows: number, payload?: { command?: string; configId?: string }) => Promise<string>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  agentDelayMs: number;
  connectingMessage: string;
  fontSize: number;
  fontFamily: string;
  gpuAccel: boolean;
  onSessionReady?: () => void;
  /** Optional output byte filter (Local removes 0x7f DEL) */
  outputFilter?: (bytes: Uint8Array) => Uint8Array | Uint8Array<ArrayBuffer>;
  /** Optional file links setup after terminal creation */
  setupFileLinks?: (term: Terminal) => void;
}
