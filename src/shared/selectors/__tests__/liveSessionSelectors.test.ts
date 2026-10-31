import { describe, expect, it } from 'vitest';

import {
  dominantState,
  isSameSession,
  sessionTab,
  sessionsByUnit,
  tabSession,
} from '@/shared/selectors/liveSessionSelectors';
import type { SessionKind, SessionState, SessionView } from '@/shared/types/liveSessions';
import type { Tab, TabData } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const MAIN_KEY = WorkspaceSession.of('p1', null).key;
const WT_KEY = WorkspaceSession.of('p1', '/proj/.worktrees/dev').key;

function session(overrides: Partial<SessionView> & { sessionId: string }): SessionView {
  return {
    kind: 'terminal' as SessionKind,
    agentId: null,
    workspaceKey: MAIN_KEY,
    title: 'Terminal',
    titleSource: 'placeholder',
    state: 'running' as SessionState,
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    turnCount: 0,
    ...overrides,
  };
}

function tabWith(data: TabData, id = 'tab-1'): Tab {
  return { id, scope: { kind: 'app' }, title: `fallback-${id}`, data };
}

describe('sessionsByUnit', () => {
  it('按 workspaceKey 分组，且保持后端顺序（不重排）', () => {
    const a = session({ sessionId: 'a', workspaceKey: MAIN_KEY });
    const b = session({ sessionId: 'b', workspaceKey: WT_KEY });
    const c = session({ sessionId: 'c', workspaceKey: MAIN_KEY });

    const byUnit = sessionsByUnit([a, b, c]);

    expect(byUnit.get(MAIN_KEY)?.map((s) => s.sessionId)).toEqual(['a', 'c']);
    expect(byUnit.get(WT_KEY)?.map((s) => s.sessionId)).toEqual(['b']);
  });

  it('空输入得到空 Map', () => {
    expect(sessionsByUnit([]).size).toBe(0);
  });

  it('分组只做 key 相等（不匹配路径前缀 —— 前缀同源的另一个单元不会串门）', () => {
    const nested = WorkspaceSession.of('p1', '/proj/.worktrees/dev').key;
    const deeper = WorkspaceSession.of('p1', '/proj/.worktrees/dev/nested').key;
    const list = [
      session({ sessionId: 'nested', workspaceKey: nested }),
      session({ sessionId: 'deeper', workspaceKey: deeper }),
    ];

    const byUnit = sessionsByUnit(list);
    expect(byUnit.get(nested)?.map((s) => s.sessionId)).toEqual(['nested']);
    expect(byUnit.get(deeper)?.map((s) => s.sessionId)).toEqual(['deeper']);
  });
});

describe('isSameSession', () => {
  it('kind 与 sessionId 必须同时相等（只比 id 就是第二套判据）', () => {
    const chat = session({ sessionId: 'x', kind: 'chat' });
    const terminal = session({ sessionId: 'x', kind: 'terminal' });
    expect(isSameSession(chat, { kind: 'chat', sessionId: 'x' })).toBe(true);
    expect(isSameSession(chat, terminal)).toBe(false);
    expect(isSameSession(terminal, { kind: 'terminal', sessionId: 'y' })).toBe(false);
  });

  it('任一侧缺失返回 false（未注册 / 无前台会话）', () => {
    const terminal = session({ sessionId: 'x' });
    expect(isSameSession(terminal, null)).toBe(false);
    expect(isSameSession(undefined, terminal)).toBe(false);
    expect(isSameSession(null, null)).toBe(false);
  });
});

describe('dominantState', () => {
  it('空列表返回 null（无会话不画点）', () => {
    expect(dominantState([])).toBeNull();
  });

  it.each<[SessionState[], SessionState]>([
    [['stopped', 'ready', 'failed', 'running', 'awaitingApproval'], 'awaitingApproval'],
    [['stopped', 'ready', 'failed', 'running'], 'running'],
    [['stopped', 'ready', 'failed'], 'failed'],
    [['stopped', 'ready'], 'ready'],
    [['stopped'], 'stopped'],
  ])('优先级 %j → %s', (states, expected) => {
    expect(dominantState(states.map((state, i) => session({ sessionId: `s${i}`, state })))).toBe(
      expected,
    );
  });
});

describe('tabSession', () => {
  const chat = session({ sessionId: 'chat-1', kind: 'chat', title: '修一下登录' });
  const terminal = session({ sessionId: 'pty-1', kind: 'terminal' });

  it('chat tab 用 data.sessionId 命中 chat 会话', () => {
    const tab = tabWith({ kind: 'agent-chat', sessionId: 'chat-1' });
    expect(tabSession(tab, [terminal, chat])?.sessionId).toBe('chat-1');
  });

  it('terminal tab 用 data.ptySessionId 命中 terminal 会话', () => {
    const tab = tabWith({ kind: 'terminal', agentId: null, ptySessionId: 'pty-1' });
    expect(tabSession(tab, [chat, terminal])?.sessionId).toBe('pty-1');
  });

  it('kind 必须同时命中：同 id 的另一 kind 不算命中（id 空间互不相干）', () => {
    const colliding = session({ sessionId: 'same', kind: 'terminal' });
    const chatTab = tabWith({ kind: 'agent-chat', sessionId: 'same' });
    expect(tabSession(chatTab, [colliding])).toBeNull();
  });

  it('未注册 / 尚未创建 PTY 时返回 null', () => {
    expect(tabSession(tabWith({ kind: 'terminal', agentId: null }), [terminal])).toBeNull();
    expect(tabSession(tabWith({ kind: 'agent-chat' }), [chat])).toBeNull();
    expect(tabSession(null, [chat])).toBeNull();
  });

  it('其它 kind 的 tab（file / diff …）没有会话身份', () => {
    const tab = tabWith({
      kind: 'file',
      filePath: '/a.ts',
      fileName: 'a.ts',
      content: { path: '/a.ts', content: '', size: 0, is_binary: false },
      isDirty: false,
    });
    expect(tabSession(tab, [chat, terminal])).toBeNull();
  });
});

describe('sessionTab（tabSession 的逆）', () => {
  it('会话 → 承载它的 tab；terminal 用 ptySessionId', () => {
    const terminal = session({ sessionId: 'pty-1', kind: 'terminal' });
    const tabs = [
      tabWith({ kind: 'agent-chat', sessionId: 'chat-1' }, 'chat-tab'),
      tabWith({ kind: 'terminal', agentId: null, ptySessionId: 'pty-1' }, 'term-tab'),
    ];
    expect(sessionTab(terminal, tabs)?.id).toBe('term-tab');
  });

  it('找不到（tab 已关闭）返回 null', () => {
    const terminal = session({ sessionId: 'pty-1', kind: 'terminal' });
    expect(sessionTab(terminal, [])).toBeNull();
  });
});
