// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeTabMock, clearProjectTabsMock, closeSessionMock, detachSessionMock } = vi.hoisted(
  () => ({
    closeTabMock: vi.fn(),
    clearProjectTabsMock: vi.fn(),
    closeSessionMock: vi.fn().mockResolvedValue(undefined),
    detachSessionMock: vi.fn().mockResolvedValue(true),
  }),
);

vi.mock('../../api/terminalApi', () => ({
  closeTerminalSession: closeSessionMock,
  detachTerminalSession: detachSessionMock,
  resizeTerminal: vi.fn(),
}));

vi.mock('../../../agent/api/agentApi', () => ({
  getAgent: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      closeTab: closeTabMock,
      clearProjectTabs: clearProjectTabsMock,
      tabs: {
        'proj-1\u0000': {
          tabs: [
            { id: 'tab_a', data: { kind: 'terminal' } },
            { id: 'tab_b', data: { kind: 'file' } },
          ],
        },
      },
    }),
  },
}));

import { useProjectStore } from '@/shared/store/projectStore';
import type { Project } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { terminalAddress } from '../terminalAddress';
import { terminalCache } from '../terminalCache';
import {
  cleanupTerminalsForTab,
  cleanupTerminalsForTabKey,
  closeAllEditorTabs,
  closeEditorTab,
} from '../terminalTabCleanup';

function makeEntry(sessionId: string | null): never {
  return {
    sessionId,
    term: { dispose: vi.fn() },
    unlisten: null,
    unlistenOutput: null,
    unlistenClosed: null,
    inputController: null,
  } as never;
}

const main = WorkspaceSession.of('proj-1', null);
const wt = WorkspaceSession.of('proj-1', '/wt');

describe('terminalTabCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalCache.clear();
    useProjectStore.setState({
      projects: [{ id: 'proj-1', environment: { type: 'Local' } } as unknown as Project],
      activeProject: null,
    });
  });

  it('cleanupTerminalsForTab 只销毁该 tab 的键（含多 pane），不动同 session 其它 tab', () => {
    terminalCache.set(terminalAddress(main, 'tab_a', 'p1'), makeEntry('s1'));
    terminalCache.set(terminalAddress(main, 'tab_a', 'p2'), makeEntry('s2'));
    terminalCache.set(terminalAddress(main, 'tab_b', 'p1'), makeEntry('s3'));

    cleanupTerminalsForTab(main.key, 'tab_a');

    expect(terminalCache.has(terminalAddress(main, 'tab_a', 'p1'))).toBe(false);
    expect(terminalCache.has(terminalAddress(main, 'tab_a', 'p2'))).toBe(false);
    expect(terminalCache.has(terminalAddress(main, 'tab_b', 'p1'))).toBe(true);
  });

  it('cleanupTerminalsForTabKey 只销毁该 workspace 单元（worktree 不波及其它单元）', () => {
    terminalCache.set(terminalAddress(wt, 'tab_a', 'p1'), makeEntry('s-wt'));
    terminalCache.set(terminalAddress(main, 'tab_a', 'p1'), makeEntry('s-main'));

    cleanupTerminalsForTabKey(wt.key);

    expect(terminalCache.has(terminalAddress(wt, 'tab_a', 'p1'))).toBe(false);
    expect(terminalCache.has(terminalAddress(main, 'tab_a', 'p1'))).toBe(true);
  });

  it('closeEditorTab 先清缓存再关 tab', () => {
    terminalCache.set(terminalAddress(main, 'tab_a', 'p1'), makeEntry('s1'));

    closeEditorTab(main.key, 'tab_a');

    expect(terminalCache.has(terminalAddress(main, 'tab_a', 'p1'))).toBe(false);
    expect(closeTabMock).toHaveBeenCalledWith(main.key, 'tab_a');
  });

  it('keepSession ⇒ 每个 pane 的 drain 都切分离态，进程不结束', () => {
    terminalCache.set(terminalAddress(main, 'tab_a', 'p1'), makeEntry('s1'));
    terminalCache.set(terminalAddress(main, 'tab_a', 'p2'), makeEntry('s2'));

    closeEditorTab(main.key, 'tab_a', { keepSession: true });

    // 一个 tab 可以拆成多 pane、各自一条 PTY —— 这正是「分离态只能在缓存层切」的理由：
    // 编排层只看到 `tab.data.ptySessionId` 一个 id，漏掉的那个 pane 会照常背压、冻住。
    expect(detachSessionMock).toHaveBeenCalledWith('s1', true);
    expect(detachSessionMock).toHaveBeenCalledWith('s2', true);
    expect(closeSessionMock).not.toHaveBeenCalled();
    expect(closeTabMock).toHaveBeenCalledWith(main.key, 'tab_a');
  });

  it('closeAllEditorTabs 清理每个 terminal tab 并 clearProjectTabs', () => {
    terminalCache.set(terminalAddress(main, 'tab_a', 'p1'), makeEntry('s1'));

    closeAllEditorTabs(main.key);

    expect(terminalCache.has(terminalAddress(main, 'tab_a', 'p1'))).toBe(false);
    expect(clearProjectTabsMock).toHaveBeenCalledWith(main.key);
  });
});
