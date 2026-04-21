import type React from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { Project } from "../../types";

export interface TerminalViewProps {
  project: Project;
  paneId?: string;
  tabId?: string | null;
  tabAgentId?: string | null;
  fontSize?: number;
  shell?: string;
  fontFamily?: string;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  agentCommandOverride?: string;
  onTabStatusChange?: (status: "Idle" | "Running" | "Failed") => void;
}

export interface TerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlistenOutput: (() => void) | null;
  unlistenClosed: (() => void) | null;
}
