import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "../terminalInput";

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
  createSession: (cols: number, rows: number) => Promise<string>;
  resizeCmd: string;
  agentDelayMs: number;
  connectingMessage: string;
  fontSize: number;
  fontFamily: string;
  gpuAccel: boolean;
  onSessionReady?: () => void;
}
