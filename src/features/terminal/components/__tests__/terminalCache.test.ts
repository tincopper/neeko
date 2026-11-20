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

import { useProjectStore } from '@/shared/store/projectStore';
import type { Project } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { terminalAddress } from '../terminalAddress';
import {
  destroyTerminalsForTab,
  refreshTerminalEntry,
  switchAgentInSessionTerminal,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
} from '../terminalCache';

function makeTerm(): Terminal {
  return { dispose: vi.fn() } as unknown as Terminal;
}

const session = WorkspaceSession.of('proj1', null);

describe('switchAgentInSessionTerminal', () => {
  const key = terminalAddress(session, 'tab1');
  let wrapper: HTMLDivElement;

  beforeEach(() => {
    wrapper = document.createElement('div');
    wslWrapperRefs.set(key, wrapper);
    useProjectStore.setState({
      projects: [
        {
          id: 'proj1',
          environment: { type: 'Wsl', distro: 'Ubuntu' },
        } as unknown as Project,
      ],
      activeProject: null,
    });
  });

  afterEach(() => {
    wslTerminalCache.clear();
    wslRebuildCallbacks.clear();
    wslWrapperRefs.clear();
    useProjectStore.setState({ projects: [], activeProject: null });
    closeSessionMock.mockClear();
  });

  it('切换 agent 时卸载旧终端的 output/closed 事件监听器并回收 PTY', async () => {
    const unlistenOutput = vi.fn();
    const unlistenClosed = vi.fn();
    const rebuild = vi.fn();
    const term = makeTerm();
    wslTerminalCache.set(key, {
      term,
      fitAddon: {} as FitAddon,
      element: document.createElement('div'),
      sessionId: 's1',
      unlisten: null,
      unlistenOutput,
      unlistenClosed,
      inputController: { dispose: vi.fn() } as never,
    });
    wslRebuildCallbacks.set(key, rebuild);

    await switchAgentInSessionTerminal(session, 'tab1', 'agent1');

    expect(unlistenOutput).toHaveBeenCalled();
    expect(unlistenClosed).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();
    expect(closeSessionMock).toHaveBeenCalledWith('s1');
    expect(wslTerminalCache.has(key)).toBe(false);
    expect(rebuild).toHaveBeenCalled();
  });
});

describe('接管来的会话不归 entry 所有（关闭只销毁缓存，不杀进程）', () => {
  const key = terminalAddress(session, 'tab2');

  function seed(attached: boolean): void {
    wslTerminalCache.set(key, {
      term: makeTerm(),
      fitAddon: {} as FitAddon,
      element: document.createElement('div'),
      sessionId: 's-lead',
      unlisten: null,
      unlistenOutput: null,
      unlistenClosed: null,
      inputController: null,
      attached,
    });
  }

  beforeEach(() => {
    useProjectStore.setState({ projects: [], activeProject: null });
  });

  afterEach(() => {
    wslTerminalCache.clear();
    wslRebuildCallbacks.clear();
    wslWrapperRefs.clear();
    closeSessionMock.mockClear();
  });

  it('attached 的 entry 被销毁时不下发 close_terminal_session', () => {
    seed(true);
    destroyTerminalsForTab(session, 'tab2');

    expect(wslTerminalCache.has(key)).toBe(false);
    expect(closeSessionMock).not.toHaveBeenCalled();
  });

  it('自己拥有的 entry 被销毁时照旧回收 PTY', () => {
    seed(false);
    destroyTerminalsForTab(session, 'tab2');

    expect(wslTerminalCache.has(key)).toBe(false);
    expect(closeSessionMock).toHaveBeenCalledWith('s-lead');
  });

  it('attached 的 entry 自愈重建时也不杀进程，但仍触发重建', () => {
    const rebuild = vi.fn();
    seed(true);
    wslRebuildCallbacks.set(key, rebuild);

    refreshTerminalEntry(key);

    expect(closeSessionMock).not.toHaveBeenCalled();
    expect(rebuild).toHaveBeenCalled();
  });
});
