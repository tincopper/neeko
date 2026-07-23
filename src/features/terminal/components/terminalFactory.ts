import { listen, emit } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';

import type { AgentConfig } from '@/shared/types';
import { buildFontFamily, buildTerminalTheme } from '@/shared/utils/terminal';

import { getAgent } from '../../agent/api/agentApi';
import { createTerminalSession } from '../api/terminalApi';

import {
  terminalCache,
  destroyTerminalCache,
  terminalRebuildCallbacks,
  executedAgentKeys,
  log,
} from './terminalCache';
import { setupTerminalInput } from './terminalInput';
import { setupTerminalLinks } from './terminalLinks';
import type { TerminalCache } from './terminalTypes';

/** 按需加载 WebGL 渲染器，失败时静默回退�?Canvas */
export async function tryLoadWebgl(term: Terminal): Promise<void> {
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl');
    term.loadAddon(new WebglAddon());
  } catch {
    /* GPU 不可�?*/
  }
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

  const element = document.createElement('div');
  element.style.width = '100%';
  element.style.height = '100%';

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
  term.unicode.activeVersion = '11';

  wrapper.appendChild(element);
  term.open(element);
  if (gpuAcceleration) await tryLoadWebgl(term);
  fitAddon.fit();

  // Setup terminal link handling (URL -> embedded browser, file paths -> file manager / editor tab)
  setupTerminalLinks(term, {
    projectPath,
    tabKey: backendProjectId,
    projectId: backendProjectId,
  });

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
  term.write('\x1b[33m[Terminal] Connecting...\x1b[0m\r\n');

  try {
    const session = await createTerminalSession(
      backendProjectId,
      initCols,
      initRows,
      shell || null,
      projectPath || null,
      taskCommand || null,
    );

    const sid = session.id;
    cache.sessionId = sid;
    log(`Session created: ${sid}, PID: ${session.pid}`);
    term.write(`\x1b[32m[Terminal] Connected (PID: ${session.pid})\x1b[0m\r\n\r\n`);

    // taskConfigId retained for editor-tab task/resume terminals only;
    // bottom Task Console no longer mounts through this factory.
    void taskConfigId;

    const unlistenOutput = await listen<number[]>(`terminal-output-${sid}`, (event) => {
      const bytes = new Uint8Array(event.payload);
      const filtered = bytes.filter((b) => b !== 0x7f);
      if (filtered.length > 0) {
        term.write(new Uint8Array(filtered));
      }
    });
    cache.unlistenOutput = unlistenOutput;

    const unlistenClosed = await listen<{ exit_code: number }>(
      `terminal-closed-${sid}`,
      async (event) => {
        log(
          `Session ${sid} closed by backend (exit_code=${event.payload?.exit_code ?? -1})`,
        );
        unlistenClosed();

        // Interactive terminal: destroy and rebuild so the shell can be reused.
        // (Task Console uses taskRunner + TaskConsoleOutput — not this path.)
        const wasExecuted = executedAgentKeys.has(cacheKey);
        destroyTerminalCache(cacheKey);
        if (wasExecuted) {
          executedAgentKeys.add(cacheKey);
        }
        terminalRebuildCallbacks.get(cacheKey)?.();
      },
    );
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
    return await getAgent(agentId);
  } catch {
    return null;
  }
}
