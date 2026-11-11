import { describe, expect, it } from 'vitest';

import {
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
    // 夹具默认「已跑完一轮」：侧栏列出需要它，需要首轮未结束的场景显式覆盖 0。
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

function tabWith(data: TabData, id = 'tab-1'): Tab {
  return { id, scope: { kind: 'app' }, title: `fallback-${id}`, data };
}

describe('isNamedSession', () => {
  it('看 titleSource 而不是「非空」：占位标签不算有名字', () => {
    // wire 上的 title 永远非空（后端会给身份标签），所以「空串」不再是「没名字」的信号 ——
    // 用非空判会让占位标签冒充真标题，刚打开的会话就会被当成已有名字。
    expect(
      isNamedSession(
        session({ sessionId: 'a', title: 'claude-code · neeko', titleSource: 'placeholder' }),
      ),
    ).toBe(false);
    for (const titleSource of ['prompt', 'native', 'user'] as const) {
      expect(isNamedSession(session({ sessionId: 'a', title: 'x', titleSource }))).toBe(true);
    }
  });
});

describe('isListedSession', () => {
  it('有标题但用户还没输入 ⇒ 不列出（CLI 启动就发 OSC 标题也不能算「会话已开始」）', () => {
    expect(
      isListedSession(
        session({ sessionId: 'a', title: 'claude', titleSource: 'native', hasUserInput: false }),
      ),
    ).toBe(false);
  });

  it('用户输入了 + 首轮跑完，但**只有占位标签** ⇒ 不列出（等标题到手再出现）', () => {
    // 侧栏要的流程：打开 CLI 不出行 → 用户输入 → 拿到真标题后出现。
    // 占位标签只是「tab / 历史列表永远有字可读」，不能当进列表的许可 ——
    // 否则一条没有信息量的行会常驻侧栏（第 35 轮踩过）。
    expect(
      isListedSession(
        session({
          sessionId: 'a',
          title: 'claude-code · neeko',
          titleSource: 'placeholder',
          hasUserInput: true,
          turnCount: 1,
        }),
      ),
    ).toBe(false);
  });

  it('用户输入后 hook 带来了真标题 ⇒ 立刻列出（不必等本轮结束）', () => {
    expect(
      isListedSession(
        session({
          sessionId: 'a',
          agentId: 'claude-code',
          title: '帮我修登录竞态',
          titleSource: 'native',
          hasUserInput: true,
          turnCount: 0,
        }),
      ),
    ).toBe(true);
  });

  it('已输入 + 有真标题 ⇒ 列出（旧版这里还写了 `title: ""` 的空串夹具，占位标签后不再成立）', () => {
    expect(isListedSession(session({ sessionId: 'a', title: 'npm test' }))).toBe(true);
  });

  it('标题到手就列出，**不看回合数**（「拿到标题就出现」）', () => {
    // 旧实现要求 `turnCount > 0`，并对 native|user 开了个直通特例（因为回填行的
    // turnCount 不落盘）。判据不再看回合数后，特例也一起消失 —— 这条用例钉住这一点。
    expect(isListedSession(session({ sessionId: 'a', title: 'npm test', turnCount: 0 }))).toBe(
      true,
    );
    for (const titleSource of ['prompt', 'native', 'user'] as const) {
      expect(
        isListedSession(
          session({ sessionId: 'a', title: 'x', titleSource, turnCount: 0, state: 'running' }),
        ),
      ).toBe(true);
    }
  });

  it('还没拿到标题（只有占位）⇒ 不列出，与回合数无关', () => {
    for (const turnCount of [0, 1, 5]) {
      expect(
        isListedSession(
          session({
            sessionId: 'a',
            kind: 'terminal',
            agentId: 'pi',
            title: 'pi · neeko',
            titleSource: 'placeholder',
            turnCount,
          }),
        ),
      ).toBe(false);
    }
  });

  it('chat 还没发过输入 ⇒ 不列出（打开 tab ≠ 在用）', () => {
    expect(isListedSession(session({ sessionId: 'c', kind: 'chat', hasUserInput: false }))).toBe(
      false,
    );
  });

  it('恢复的历史会话（turnCount 不落盘 ⇒ 0）⇒ 照样列出', () => {
    // 这是「不看回合数」的直接收益：回填行不需要任何特例。
    expect(
      isListedSession(
        session({ sessionId: 'restored', kind: 'chat', title: '构建日志', titleSource: 'prompt' }),
      ),
    ).toBe(true);
  });
});

describe('sessionsByUnit', () => {
  it('只有占位标签的会话不进分组（不画一行没有信息量的行）', () => {
    const list = [
      session({ sessionId: 'named', title: 'fix login', titleSource: 'prompt' }),
      session({ sessionId: 'unnamed', title: 'claude-code · neeko', titleSource: 'placeholder' }),
    ];
    const byUnit = sessionsByUnit(list);
    expect(byUnit.get(MAIN_KEY)?.map((s) => s.sessionId)).toEqual(['named']);
  });

  it('未输入的会话不进分组（打开 tab ≠ 在用）', () => {
    const list = [session({ sessionId: 'opened', hasUserInput: false })];
    expect(sessionsByUnit(list).size).toBe(0);
  });

  it('chat 只要标题到手就进分组（不等回合结束）', () => {
    const running = session({
      sessionId: 'running',
      kind: 'chat',
      title: '修一下登录跳转',
      turnCount: 0,
      state: 'running',
    });
    const unnamed = session({
      sessionId: 'unnamed',
      kind: 'chat',
      title: 'pi · neeko',
      titleSource: 'placeholder',
    });
    expect(
      sessionsByUnit([running, unnamed])
        .get(MAIN_KEY)
        ?.map((s) => s.sessionId),
    ).toEqual(['running']);
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

  it('前台会话还没名字 ⇒ 侧栏没有子行，父行不让出选中底', () => {
    const refs = [{ workspaceKey: MAIN_KEY, kind: 'terminal' as const, sessionId: 'opened' }];
    expect(
      unitsWithListedActiveSession(refs, [
        session({
          sessionId: 'opened',
          title: 'neeko',
          titleSource: 'placeholder',
          hasUserInput: false,
        }),
      ]),
    ).toEqual(new Set());
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

  it('只有占位标签的会话不算「上次那一条」（它还没进侧栏）', () => {
    const unnamed = session({
      sessionId: 'unnamed',
      startedAt: late,
      title: 'claude-code · neeko',
      titleSource: 'placeholder',
    });
    expect(selectLatestSessionForUnit([unnamed], MAIN_KEY, 'terminal')).toBeNull();
  });

  it('无命中返回 null（注册表为空）', () => {
    expect(selectLatestSessionForUnit([], MAIN_KEY, 'chat')).toBeNull();
  });
});
