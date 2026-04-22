import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

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
}
