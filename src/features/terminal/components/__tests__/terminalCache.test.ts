import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { closeSessionMock, getAgentMock } = vi.hoisted(() => ({
  closeSessionMock: vi.fn().mockResolvedValue(undefined),
  getAgentMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../api/terminalApi', () => ({
  closeTerminalSession: closeSessionMock,
}));

vi.mock('../../../agent/api/agentApi', () => ({
  getAgent: getAgentMock,
}));

import {
  switchAgentInAnyTerminal,
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
} from '../terminalCache';

function makeTerm(): Terminal {
  return { dispose: vi.fn() } as unknown as Terminal;
}

describe('switchAgentInAnyTerminal', () => {
  const key = 'proj1:p1';
  let wrapper: HTMLDivElement;

  beforeEach(() => {
    wrapper = document.createElement('div');
    terminalWrapperRefs.set(key, wrapper);
  });

  afterEach(() => {
    terminalCache.clear();
    terminalRebuildCallbacks.clear();
    terminalWrapperRefs.clear();
    closeSessionMock.mockClear();
  });

  it('切换 agent 时卸载旧终端的 output/closed 事件监听器', async () => {
    const unlistenOutput = vi.fn();
    const unlistenClosed = vi.fn();
    const term = makeTerm();
    terminalCache.set(key, {
      term,
      fitAddon: {} as FitAddon,
      element: document.createElement('div'),
      sessionId: 's1',
      unlistenOutput,
      unlistenClosed,
      inputController: { dispose: vi.fn() } as never,
    });

    await switchAgentInAnyTerminal(key, 'agent1');

    expect(unlistenOutput).toHaveBeenCalled();
    expect(unlistenClosed).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();
    expect(closeSessionMock).toHaveBeenCalledWith('s1');
  });
});
