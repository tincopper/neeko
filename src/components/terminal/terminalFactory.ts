import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { buildFontFamily } from "../../utils/terminal";
import { IS_MACOS } from "../../utils/platform";
import type { AgentConfig } from "../../types";
import {
  terminalCache,
  destroyTerminalCache,
  terminalRebuildCallbacks,
  log,
} from "./terminalCache";
import type { TerminalCache } from "./terminalTypes";

export async function createTerminalForProject(
  cacheKey: string,
  projectPath: string,
  projectName: string,
  _selectedAgentId: string | null,
  fontSize: number,
  wrapper: HTMLElement,
  shell: string,
  fontFamily: string,
  backendProjectId: string,
  _agentCommandOverrides?: Record<string, string>,
): Promise<TerminalCache> {
  log(`Creating new terminal for project ${projectName}`);

  const element = document.createElement("div");
  element.style.width = "100%";
  element.style.height = "100%";

  const cssVar = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const term = new Terminal({
    cursorBlink: true,
    fontSize,
    fontFamily: buildFontFamily(fontFamily),
    theme: {
      background: cssVar("--bg-primary") || "#000000",
      foreground: cssVar("--text-primary") || "#ededed",
      cursor: cssVar("--accent-blue") || "#ffffff",
      selectionBackground: cssVar("--terminal-selection") || "#333333",
      selectionForeground: cssVar("--text-primary") || "#ededed",
      black: "#000000",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
    scrollback: 10000,
    overviewRuler: { width: 0 },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = "11";

  wrapper.appendChild(element);
  term.open(element);
  fitAddon.fit();
  const initCols = term.cols;
  const initRows = term.rows;
  log(`Initial size: ${initCols}x${initRows}`);

  const cache: TerminalCache = {
    term,
    fitAddon,
    element,
    sessionId: null,
    unlistenOutput: null,
    unlistenClosed: null,
  };

  terminalCache.set(cacheKey, cache);
  term.write("\x1b[33m[Terminal] Connecting...\x1b[0m\r\n");

  try {
    const session = await invoke<{ id: string; pid: number | null }>(
      "create_terminal_session",
      {
        projectId: backendProjectId,
        cols: initCols,
        rows: initRows,
        shell: shell || null,
        workingDir: projectPath || null,
      },
    );

    const sid = session.id;
    cache.sessionId = sid;
    log(`Session created: ${sid}, PID: ${session.pid}`);
    term.write(
      `\x1b[32m[Terminal] Connected (PID: ${session.pid})\x1b[0m\r\n\r\n`,
    );

    const unlistenOutput = await listen<number[]>(
      `terminal-output-${sid}`,
      (event) => {
        const bytes = new Uint8Array(event.payload);
        const filtered = bytes.filter((b) => b !== 0x7f);
        if (filtered.length > 0) {
          term.write(new Uint8Array(filtered));
        }
      },
    );
    cache.unlistenOutput = unlistenOutput;

    const unlistenClosed = await listen<null>(`terminal-closed-${sid}`, async () => {
      log(`Session ${sid} closed by backend`);
      unlistenClosed();
      destroyTerminalCache(cacheKey);
      terminalRebuildCallbacks.get(cacheKey)?.();
    });
    cache.unlistenClosed = unlistenClosed;

    let isComposing = false;
    let compositionPendingText = "";

    const sendInput = (text: string) => {
      const bytes = Array.from(new TextEncoder().encode(text));
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`Input emit error: ${err}`);
      });
    };

    const textarea = term.textarea;
    if (textarea) {
      const syncTextareaToCursor = () => {
        const cursorEl = element.querySelector(".xterm-cursor");
        if (!cursorEl) {
          return;
        }
        const cursorRect = cursorEl.getBoundingClientRect();
        const containerRect = element.getBoundingClientRect();
        const top = cursorRect.top - containerRect.top;
        const left = cursorRect.left - containerRect.left;
        textarea.style.top = `${top}px`;
        textarea.style.left = `${left}px`;
      };

      textarea.addEventListener("keydown", (e: KeyboardEvent) => {
        if ((e.isComposing || e.keyCode === 229) && !isComposing) {
          isComposing = true;
          compositionPendingText = "";
          syncTextareaToCursor();
        }
      });

      textarea.addEventListener("compositionstart", () => {
        isComposing = true;
        compositionPendingText = "";
        syncTextareaToCursor();
      });

      textarea.addEventListener("compositionend", (e: CompositionEvent) => {
        const committed = e.data || "";
        if (committed) {
          compositionPendingText = committed;
          sendInput(committed);
          const resetDelay = IS_MACOS ? 150 : 50;
          setTimeout(() => {
            isComposing = false;
            compositionPendingText = "";
          }, resetDelay);
        } else {
          isComposing = false;
          compositionPendingText = "";
        }
      });
    }

    term.onData((data) => {
      if (isComposing) {
        return;
      }
      if (compositionPendingText && data === compositionPendingText) {
        compositionPendingText = "";
        return;
      }
      sendInput(data);
    });
  } catch (err) {
    log(`ERROR: ${err}`);
    term.write(`\x1b[31m[Terminal] Connection failed: ${err}\x1b[0m\r\n`);
  }

  return cache;
}

export async function getAgentById(agentId: string): Promise<AgentConfig | null> {
  try {
    return await invoke<AgentConfig>("get_agent", { agentId });
  } catch {
    return null;
  }
}
