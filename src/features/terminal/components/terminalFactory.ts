import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { buildFontFamily, buildTerminalTheme } from "../../../utils/terminal";
import type { AgentConfig } from "../../../types";
import { useEditorStore } from "../../../store/editorStore";
import {
  terminalCache,
  destroyTerminalCache,
  terminalRebuildCallbacks,
  executedAgentKeys,
  log,
} from "./terminalCache";
import type { TerminalCache } from "./terminalTypes";
import { setupTerminalInput } from "./terminalInput";
import { setupTerminalLinks } from "./terminalLinks";

/** 鎸夐渶鍔犺浇 WebGL 娓叉煋鍣紝澶辫触鏃堕潤榛樺洖閫€鍒?Canvas */
export async function tryLoadWebgl(term: Terminal): Promise<void> {
  try {
    const { WebglAddon } = await import("@xterm/addon-webgl");
    term.loadAddon(new WebglAddon());
  } catch { /* GPU 涓嶅彲鐢?*/ }
}

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
  taskCommand?: string,
  taskConfigId?: string,
  gpuAcceleration?: boolean,
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
  if (gpuAcceleration) await tryLoadWebgl(term);
  fitAddon.fit();

  // Setup terminal link handling (URL -> embedded browser, file paths -> file manager)
  setupTerminalLinks(term, projectPath);

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
        command: taskCommand || null,
      },
    );

    const sid = session.id;
    cache.sessionId = sid;
    log(`Session created: ${sid}, PID: ${session.pid}`);
    term.write(
      `\x1b[32m[Terminal] Connected (PID: ${session.pid})\x1b[0m\r\n\r\n`,
    );

    // If this is a task terminal, write back the PTY session ID to taskStore
    if (taskConfigId) {
      const { useTaskStore } = await import("../../../store/taskStore");
      useTaskStore.getState().setPtySessionId(backendProjectId, sid);
    }

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

    const unlistenClosed = await listen<{ exit_code: number }>(`terminal-closed-${sid}`, async (event) => {
      const exitCode = event.payload?.exit_code ?? -1;
      log(`Session ${sid} closed by backend (exit_code=${exitCode})`);
      unlistenClosed();

      if (taskConfigId) {
        // Task terminal: process exited naturally.
        // - Notify taskStore so the Play button returns to idle.
        // - Update the tab status to Idle (success) or Failed (non-zero exit).
        // - Keep the cache alive so the output stays visible on screen.
        // - Do NOT destroy cache or trigger rebuild (prevents flicker/re-execute).
        const { useTaskStore } = await import("../../../store/taskStore");
        const ts = useTaskStore.getState();
        if (ts.taskStates[backendProjectId]?.ptySessionId === sid) {
          ts.markIdle(backendProjectId);
        }

        // Reflect success/failure in the tab so the UI can show the right indicator
        // and so taskStore.runTask() can decide whether to reuse the tab.
        // Use the project ID captured at terminal-creation time (backendProjectId)
        // rather than appState.activeProject — the user may have switched to a
        // different project while the task was running, making activeProject null
        // or pointing to the wrong project.
        const appState = useEditorStore.getState();
        const tabKey = backendProjectId;
        const pt = appState.tabs[tabKey];
        const tab = pt?.tabs.find(
          (t) =>
            t.data.kind === "terminal" &&
            t.data.taskConfigId === taskConfigId &&
            t.data.status === "Running",
        );
        if (tab) {
          appState.updateTab(tabKey, tab.id, {
            status: exitCode === 0 ? "Idle" : "Failed",
          });
        }

        // Show a dim completion marker at the bottom of the terminal output
        const exitLabel =
          exitCode === 0
            ? "\r\n\x1b[90m[Process exited with code 0]\x1b[0m\r\n"
            : `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
        term.write(exitLabel);
        // Clear sessionId so resize/input calls no-op gracefully
        cache.sessionId = null;
        return;
      }

      // Normal (non-task) terminal: existing behavior 鈥?destroy and rebuild
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

