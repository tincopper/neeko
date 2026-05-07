import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { buildFontFamily, buildTerminalTheme } from "../../utils/terminal";
import type { AgentConfig } from "../../types";
import {
  terminalCache,
  destroyTerminalCache,
  terminalRebuildCallbacks,
  executedAgentKeys,
  log,
} from "./terminalCache";
import type { TerminalCache } from "./terminalTypes";
import { setupTerminalInput } from "./terminalInput";

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

  const term = new Terminal({
    cursorBlink: true,
    fontSize,
    fontFamily: buildFontFamily(fontFamily),
    theme: buildTerminalTheme(),
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
    inputController: null,
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
      const wasExecuted = executedAgentKeys.has(cacheKey);
      destroyTerminalCache(cacheKey);
      if (wasExecuted) {
        executedAgentKeys.add(cacheKey);
      }
      terminalRebuildCallbacks.get(cacheKey)?.();
    });
    cache.unlistenClosed = unlistenClosed;

    const sendInput = (text: string) => {
      const bytes = Array.from(new TextEncoder().encode(text));
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`Input emit error: ${err}`);
      });
    };

    cache.inputController = setupTerminalInput({ term, sendInput });
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
