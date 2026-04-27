import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";

export interface TerminalViewProps {
  paneId: string;
}

export interface TerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlistenOutput: (() => void) | null;
  unlistenClosed: (() => void) | null;
  inputController: TerminalInputController | null;
}
