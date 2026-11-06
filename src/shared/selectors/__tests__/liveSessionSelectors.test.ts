import { describe, expect, it } from 'vitest';

import {
  dominantState,
  isBusySession,
  isLiveSession,
  isListedSession,
  isNamedSession,
  isSameSession,
  sessionTab,
  selectLatestSessionForUnit,
  sessionsByUnit,
  tabSession,
  unitsWithListedActiveSession,
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
    title: 'fix the parser',
    titleSource: 'prompt',
    state: 'running' as SessionState,
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    turnCount: 0,
    hasUserInput: true,
    ...overrides,
  };
}

function tabWith(data: TabData, id = 'tab-1'): Tab {
  return { id, scope: { kind: 'app' }, title: `fallback-${id}`, data };
}

describe('isNamedSession', () => {
  it('占位来源 / 空标题都算「还没有名字」', () => {
    expect(isNamedSession(session({ sessionId: 'a', title: '', titleSource: 'placeholder' }))).toBe(
      false,
    );
    // 兜底：来源非占位但标题是空白，同样不算有名字（渲染期兜底 tab.title）
    expect(isNamedSession(session({ sessionId: 'b', title: '   ', titleSource: 'native' }))).toBe(
      false,
    );
  });

  it('真标题（prompt / native / user）才算有名字', () => {
    for (const titleSource of ['prompt', 'native', 'user'] as const) {
      expect(isNamedSession(session({ sessionId: 'a', title: 'x', titleSource }))).toBe(true);
    }
  });
});

describe('isListedSession', () => {
  it('有标题但用户还没输入 ⇒ 不列出（CLI 启动就发 OSC 标题也不能算「会话已开始」）', () => {
    const startupTitle = session({
      sessionId: 'a',
      title: 'claude',
      titleSource: 'native',
      hasUserInput: false,
    });
    expect(isNamedSession(startupTitle)).toBe(true);
    expect(isListedSession(startupTitle)).toBe(false);
  });

  it('用户输入了但还没有标题 ⇒ **仍要列出**（可见性与命名是两件事）', () => {
    // 第 35 轮把「首条终端输入 = 标题」删掉后，无 hook 的 CLI 永远等不到标题；
    // 若继续把「有名字」当列出条件，终端会话会整条从侧栏消失（实测回归）。
    expect(
      isListedSession(
        session({ sessionId: 'a', title: '', titleSource: 'placeholder', hasUserInput: true }),
      ),
    ).toBe(true);
  });

  it('已输入 + 有标题 ⇒ 列出', () => {
    expect(isListedSession(session({ sessionId: 'a', title: 'npm test' }))).toBe(true);
  });
});

describe('sessionsByUnit', () => {
  it('无名但已输入的会话**要**进分组（否则终端会话整条消失）', () => {
    const list = [
      session({ sessionId: 'named', title: 'fix login', titleSource: 'prompt' }),
      session({ sessionId: 'unnamed', title: '', titleSource: 'placeholder' }),
    ];
    const byUnit = sessionsByUnit(list);
    expect(byUnit.get(MAIN_KEY)?.map((s) => s.sessionId)).toEqual(['named', 'unnamed']);
  });

  it('未输入的会话不进分组（打开 tab ≠ 在用）', () => {
    const list = [session({ sessionId: 'opened', hasUserInput: false })];
    expect(sessionsByUnit(list).size).toBe(0);
  });

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

describe('unitsWithListedActiveSession', () => {
  it('前台 tab 的会话未输入 ⇒ 父行不应让出选中态', () => {
    const refs = [{ workspaceKey: MAIN_KEY, kind: 'terminal' as const, sessionId: 'hidden' }];
    expect(
      unitsWithListedActiveSession(refs, [
        session({
          sessionId: 'hidden',
          hasUserInput: false,
          title: 'claude',
          titleSource: 'native',
        }),
      ]),
    ).toEqual(new Set());
  });

  it('前台会话已输入但还没名字 ⇒ 子行仍会画出来，父行要让出选中底', () => {
    const refs = [{ workspaceKey: MAIN_KEY, kind: 'terminal' as const, sessionId: 'unnamed' }];
    expect(
      unitsWithListedActiveSession(refs, [
        session({ sessionId: 'unnamed', title: '', titleSource: 'placeholder' }),
      ]),
    ).toEqual(new Set([MAIN_KEY]));
  });

  it('前台 tab 的会话在可见集合里 ⇒ 对应单元计入', () => {
    const refs = [{ workspaceKey: MAIN_KEY, kind: 'terminal' as const, sessionId: 'listed' }];
    expect(
      unitsWithListedActiveSession(refs, [
        session({ sessionId: 'listed', title: 'npm test', hasUserInput: true }),
      ]),
    ).toEqual(new Set([MAIN_KEY]));
  });

  it('同 id 但不同 kind 不算同一条会话', () => {
    const refs = [{ workspaceKey: MAIN_KEY, kind: 'chat' as const, sessionId: 'same' }];
    expect(
      unitsWithListedActiveSession(refs, [
        session({ sessionId: 'same', kind: 'terminal', title: 'npm test', hasUserInput: true }),
      ]),
    ).toEqual(new Set());
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

describe('isLiveSession / isBusySession —— 两个不同的问题', () => {
  it('进程还活着：running / awaitingApproval / ready 都算，终止态不算', () => {
    for (const state of ['running', 'awaitingApproval', 'ready'] as const) {
      expect(isLiveSession(session({ sessionId: 'a', state }))).toBe(true);
    }
    for (const state of ['stopped', 'failed'] as const) {
      expect(isLiveSession(session({ sessionId: 'a', state }))).toBe(false);
    }
  });

  it('正在干活：只有 running / awaitingApproval', () => {
    for (const state of ['running', 'awaitingApproval'] as const) {
      expect(isBusySession(session({ sessionId: 'a', state }))).toBe(true);
    }
    // ready = agent 干完了（进程还在等下一次输入）—— 关 tab 时不该弹「它还在跑」。
    for (const state of ['ready', 'stopped', 'failed'] as const) {
      expect(isBusySession(session({ sessionId: 'a', state }))).toBe(false);
    }
  });
});

describe('selectLatestSessionForUnit —— 点图标时该接回哪一条', () => {
  const early = '2026-10-31T10:00:00.000Z';
  const late = '2026-11-02T08:30:00.000Z';
  const middle = '2026-11-01T12:00:00.000Z';

  it('按 startedAt 取最新（乱序输入也要对 —— 不依赖数组顺序）', () => {
    const sessions = [
      session({ sessionId: 'late', startedAt: late }),
      session({ sessionId: 'early', startedAt: early }),
      session({ sessionId: 'middle', startedAt: middle }),
    ];
    expect(selectLatestSessionForUnit(sessions, MAIN_KEY, 'terminal')?.sessionId).toBe('late');

    // 反序输入 → 同一答案（把「哪条更新」寄托在顺序上就会在这里分叉）
    const reversed = [...sessions].reverse();
    expect(selectLatestSessionForUnit(reversed, MAIN_KEY, 'terminal')?.sessionId).toBe('late');
  });

  it('kind 隔离：chat 不被 terminal 的会话命中', () => {
    const sessions = [session({ sessionId: 'term-new', kind: 'terminal', startedAt: late })];
    expect(selectLatestSessionForUnit(sessions, MAIN_KEY, 'chat')).toBeNull();
    expect(selectLatestSessionForUnit(sessions, MAIN_KEY, 'terminal')?.sessionId).toBe('term-new');
  });

  it('unit 隔离：worktree 的会话不会被主仓命中（反之亦然）', () => {
    const sessions = [session({ sessionId: 'wt', workspaceKey: WT_KEY })];
    expect(selectLatestSessionForUnit(sessions, MAIN_KEY, 'terminal')).toBeNull();
    expect(selectLatestSessionForUnit(sessions, WT_KEY, 'terminal')?.sessionId).toBe('wt');
  });

  it('未 listed（用户没发过输入）的会话不参与 —— 否则第一次点图标就接回一个空会话', () => {
    const sessions = [session({ sessionId: 'silent', startedAt: late, hasUserInput: false })];
    expect(selectLatestSessionForUnit(sessions, MAIN_KEY, 'terminal')).toBeNull();

    // 去掉噪声后，真正用过的那条才被选中
    const listed = session({ sessionId: 'listed', startedAt: early });
    expect(selectLatestSessionForUnit([...sessions, listed], MAIN_KEY, 'terminal')?.sessionId).toBe(
      'listed',
    );
  });

  it('已输入但还没名字的会话**算**用过（无 hook 的终端永远等不到标题）', () => {
    const unnamed = session({
      sessionId: 'unnamed',
      startedAt: late,
      title: '',
      titleSource: 'placeholder',
    });
    expect(selectLatestSessionForUnit([unnamed], MAIN_KEY, 'terminal')?.sessionId).toBe('unnamed');
  });

  it('无命中返回 null（注册表为空）', () => {
    expect(selectLatestSessionForUnit([], MAIN_KEY, 'chat')).toBeNull();
  });
});
