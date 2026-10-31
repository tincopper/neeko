import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { closeSessionMock, getAgentMock } = vi.hoisted(() => ({
  closeSessionMock: vi.fn().mockResolvedValue(undefined),
  getAgentMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../api/terminalApi', () => ({
  closeTerminalSession: closeSessionMock,
  resizeTerminal: vi.fn(),
}));

vi.mock('../../../agent/api/agentApi', () => ({
  getAgent: getAgentMock,
}));

import { useEditorStore } from '@/shared/store/editorStore';
import type { TerminalTabData } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { terminalAddress } from '../terminalAddress';
import { switchAgentInTerminal } from '../terminalAgentSwitch';
import { terminalCache, terminalRebuildCallbacks, terminalWrapperRefs } from '../terminalCache';

const session = WorkspaceSession.of('proj1', null);
const key = terminalAddress(session, 'tab1');

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

function seedTab(): void {
  useEditorStore.setState({
    tabs: {
      [session.key]: {
        tabs: [
          {
            id: 'tab1',
            scope: { kind: 'workspace', session },
            title: 'Terminal',
            data: { kind: 'terminal', agentId: null },
          },
        ],
      } as never,
    },
  });
}

function tabAgentId(): string | null {
  const data = useEditorStore.getState().tabs[session.key].tabs[0].data as TerminalTabData;
  return data.agentId;
}

describe('switchAgentInTerminal（唯一 env-blind 能力）', () => {
  beforeEach(() => {
    seedTab();
    closeSessionMock.mockClear();
  });

  afterEach(() => {
    terminalCache.clear();
    terminalWrapperRefs.clear();
    terminalRebuildCallbacks.clear();
    useEditorStore.setState({ tabs: {} });
  });

  it('目标 agent 落到 tab 身份，并委托底层清 PTY + 触发重建', async () => {
    terminalCache.set(key, makeEntry('s1'));
    terminalWrapperRefs.set(key, document.createElement('div'));
    const rebuild = vi.fn();
    terminalRebuildCallbacks.set(key, rebuild);

    await switchAgentInTerminal(session, 'tab1', 'agentX');

    expect(tabAgentId()).toBe('agentX');
    expect(terminalCache.has(key)).toBe(false);
    expect(rebuild).toHaveBeenCalled();
    expect(closeSessionMock).toHaveBeenCalledWith('s1');
  });

  /**
   * 旧形态是「传 null → 内部用 `firstTerminalKeyOfSession` 取 Map 插入顺序首个」，
   * 那与本任务 R1/R3 删除的第二口径同罪（同一时刻「插入落哪个 tab」按 order 升序、
   * 「切 agent 落哪个 PTY」按 Map 插入顺序 → 两个答案）。
   * 现在 `tabId` 必填（null 在类型层面不可写），调用方必须先经
   * `foregroundTerminalTab` 仲裁 —— 该链路的验收在 `terminalRouting.test.ts` 与
   * `useWslActions.test.ts` / `useRemoteActions.test.ts`。
   * 本用例只钉住剩下的那件事：**给定精确 tabId 时不得碰别的终端**。
   */
  it('只动给定 tabId 的终端，不波及其他 session/其他 tab', async () => {
    const wt = WorkspaceSession.of('proj1', '/wt/a');
    const wtKey = terminalAddress(wt, 'tab1');
    const otherTabKey = terminalAddress(session, 'tab2');
    terminalCache.set(key, makeEntry('s-main'));
    terminalCache.set(wtKey, makeEntry('s-wt'));
    terminalCache.set(otherTabKey, makeEntry('s-other'));
    terminalWrapperRefs.set(key, document.createElement('div'));

    await switchAgentInTerminal(session, 'tab1', 'agentX');

    // 目标键被清（无 rebuild 回调时仍走 wrapper 拆除路径），其余两键必须存活。
    expect(terminalCache.has(key)).toBe(false);
    expect(terminalCache.has(wtKey)).toBe(true);
    expect(terminalCache.has(otherTabKey)).toBe(true);
    // tab 身份只落在被指定的那个 tab 上。
    expect(tabAgentId()).toBe('agentX');
  });

  /** 目标键在缓存里不存在（PTY 尚未建立）→ 空转，不抛、不写别的终端。 */
  it('tabId 指向不存在的终端 → 空转（不抛错）', async () => {
    await expect(switchAgentInTerminal(session, 'not-there', 'agentX')).resolves.toBeUndefined();
    expect(terminalCache.size).toBe(0);
  });
});
