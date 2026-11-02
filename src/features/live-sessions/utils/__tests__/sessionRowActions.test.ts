import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/liveSessionsApi', () => ({
  setLiveSessionTitle: vi.fn(() => Promise.resolve(true)),
  deleteLiveSession: vi.fn(() => Promise.resolve(true)),
}));

import {
  useCloseConfirmStore,
  setCloseConfirmHostMounted,
} from '@/features/editor/store/closeConfirmStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { deleteLiveSession, setLiveSessionTitle } from '../../api/liveSessionsApi';
import { deleteSession, renameSession } from '../sessionRowActions';

const KEY = WorkspaceSession.of('p1', '/proj-wt').key;

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-1',
    kind: 'terminal',
    agentId: 'claude-code',
    workspaceKey: KEY,
    title: '修复登录竞态',
    titleSource: 'prompt',
    state: 'ready',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

function terminalTab(id: string, ptySessionId?: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', '/proj-wt') },
    title: 'Claude Code',
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
}

beforeEach(() => {
  vi.mocked(setLiveSessionTitle).mockClear();
  vi.mocked(deleteLiveSession).mockClear();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useCloseConfirmStore.setState({ pending: null });
  setCloseConfirmHostMounted(true);
});

describe('sessionRowActions — 改名', () => {
  it('落 `user` 来源：用户改的名字不该被后续自动标题覆盖', () => {
    renameSession(session(), '我的新名字');

    expect(setLiveSessionTitle).toHaveBeenCalledWith('pty-1', '我的新名字', 'user');
  });
});

describe('sessionRowActions — 删除', () => {
  it('先弹确认，不确认就不删（返回 false = 用户取消）', async () => {
    const pending = deleteSession(session());

    expect(useCloseConfirmStore.getState().pending).toEqual({
      kind: 'delete-session',
      title: '修复登录竞态',
    });
    expect(deleteLiveSession).not.toHaveBeenCalled();

    useCloseConfirmStore.getState().resolve('cancel');
    await expect(pending).resolves.toBe(false);
    expect(deleteLiveSession).not.toHaveBeenCalled();
  });

  it('确认后删除这条会话（返回 true = 已发起）', async () => {
    const pending = deleteSession(session());

    useCloseConfirmStore.getState().resolve('delete');

    await expect(pending).resolves.toBe(true);
    expect(deleteLiveSession).toHaveBeenCalledWith('pty-1');
  });

  it('没有标题时用 sessionId 点名（确认框不能是一句空话）', async () => {
    void deleteSession(session({ title: '', titleSource: 'placeholder' }));

    expect(useCloseConfirmStore.getState().pending).toEqual({
      kind: 'delete-session',
      title: 'pty-1',
    });
  });
});

describe('sessionRowActions — 删除时连 tab 一起关', () => {
  it('有关联 tab ⇒ 关掉它，再删条目', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1);

    void deleteSession(session());
    useCloseConfirmStore.getState().resolve('delete');
    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().tabs[KEY]?.tabs ?? []).toHaveLength(0);
    expect(deleteLiveSession).toHaveBeenCalledWith('pty-1');
  });

  it('没有关联 tab（会话已后台运行 / tab 已关）⇒ 只删条目，不报错', async () => {
    void deleteSession(session());
    useCloseConfirmStore.getState().resolve('delete');
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteLiveSession).toHaveBeenCalledWith('pty-1');
  });

  it('取消 ⇒ tab 与条目都不动', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));

    void deleteSession(session());
    useCloseConfirmStore.getState().resolve('cancel');
    await Promise.resolve();

    expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1);
    expect(deleteLiveSession).not.toHaveBeenCalled();
  });
});
