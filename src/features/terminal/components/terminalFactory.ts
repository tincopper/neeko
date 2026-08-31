import { listen, emit } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';

import type { AgentConfig } from '@/shared/types';
import { createPollingDrainScheduler } from '@/shared/utils/drainLoop';
import { applyRenderer, buildTerminalTheme, TERMINAL_SCROLLBACK } from '@/shared/utils/terminal';
import { terminalClosedEvent, terminalInputEvent } from '@/shared/utils/terminalEvents';
import { setupTerminalInput } from '@/shared/utils/terminalInput';
import { buildMonoStack, MONO_LINE_HEIGHT } from '@/shared/utils/typography';

// eslint-disable-next-line import/no-restricted-paths -- terminal factory needs agent API for agent config
import { getAgent } from '../../agent/api/agentApi';
import { createTerminalSession, drainTerminal } from '../api/terminalApi';

import {
  terminalCache,
  destroyTerminalCache,
  terminalRebuildCallbacks,
  executedAgentKeys,
  log,
} from './terminalCache';
import { setupTerminalLinks } from './terminalLinks';
import type { TerminalCache } from './terminalTypes';

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
    fontFamily: buildMonoStack(fontFamily),
    lineHeight: MONO_LINE_HEIGHT,
    theme: buildTerminalTheme(),
    scrollback: TERMINAL_SCROLLBACK,
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
  // 渲染器：确定性 RendererPlan 选型（启动期探测 + 预热，见 shared/utils/terminal）。
  // GPU 配置开启且 webgl 可用 → WebGL；否则 Canvas（xterm 6 默认 DOM renderer
  // 在 TUI 高频重绘下内存爆炸）。降级仅发生在真实能力边界且已打点。
  await applyRenderer(term, !!gpuAcceleration);
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

    // credit-pull 输出协议（内存治理）：轮询驱动二进制拉取。无在途
    // 门闸（pendingWrites 恒 0），循环拉到空为止 —— 与旧推送语义等价，
    // 但消除了 JSON 膨胀与事件洪泛。
    // 方案 B（去 eval 化）：触发源由 terminal-drain-{id} 事件改为全局共享
    // 轮询器（createPollingDrainScheduler）——macOS 上事件送达 = 每次
    // evaluateJavaScript，WebKit 无条件克隆+stringify 完成值导致 WebContent
    // RSS 只增不减；invoke 走 custom protocol fetch，零 eval 零克隆。
    const scheduler = createPollingDrainScheduler({
      sessionId: sid,
      drain: drainTerminal,
      write: (chunk) => {
        const filtered = new Uint8Array(chunk).filter((b) => b !== 0x7f);
        if (filtered.length > 0) {
          term.write(filtered);
        }
      },
      pendingWrites: () => 0,
    });
    // dispose 挂到 unlistenOutput 槽位：terminalCache 销毁/重建统一经
    // entry.unlistenOutput?.() 清理，轮询注销幂等安全。
    cache.unlistenOutput = () => {
      scheduler.dispose();
    };

    const unlistenClosed = await listen<{ exit_code: number }>(
      terminalClosedEvent(sid),
      async (event) => {
        log(`Session ${sid} closed by backend (exit_code=${event.payload?.exit_code ?? -1})`);
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
      emit(terminalInputEvent(sid), bytes).catch((err) => {
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
