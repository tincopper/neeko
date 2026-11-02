import { describe, expect, it } from 'vitest';

import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { planSessionActivation } from '../sessionActivationPlan';

const WS = WorkspaceSession.of('p1', '/proj-wt');
const KEY = WS.key;

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

function terminalTab(
  id: string,
  ptySessionId?: string,
  agentId: string | null = 'claude-code',
): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WS },
    title: 'Claude Code',
    data: { kind: 'terminal', agentId, ptySessionId },
  };
}

describe('planSessionActivation', () => {
  it('映射键命中 ⇒ 激活（绝大多数点击）', () => {
    expect(
      planSessionActivation({ session: session(), tabs: [terminalTab('t1', 'pty-1')] }),
    ).toEqual({ kind: 'activate', tabId: 't1' });
  });

  it('映射键丢了但只有一条同 agent 的孤儿 tab ⇒ 认领它，不新建', () => {
    // 写入被丢弃的现场：tab 在、PTY 在，但 ptySessionId 是空的。
    expect(planSessionActivation({ session: session(), tabs: [terminalTab('t1')] })).toEqual({
      kind: 'bind',
      tabId: 't1',
    });
  });

  it('多条孤儿候选 ⇒ 重建（猜错会把身份写到别人的 tab 上）', () => {
    expect(
      planSessionActivation({
        session: session(),
        tabs: [terminalTab('t1'), terminalTab('t2')],
      }),
    ).toEqual({ kind: 'recreate' });
  });

  it('孤儿候选的 agent 不同 ⇒ 不认领', () => {
    expect(
      planSessionActivation({
        session: session({ agentId: 'claude-code' }),
        tabs: [terminalTab('t1', undefined, 'codex')],
      }),
    ).toEqual({ kind: 'recreate' });
  });

  it('已经绑了别的会话的 tab ⇒ 不认领', () => {
    expect(
      planSessionActivation({
        session: session(),
        tabs: [terminalTab('t1', 'pty-other')],
      }),
    ).toEqual({ kind: 'recreate' });
  });

  it('没有 tab ⇒ 重建（点击永远有结果，不静默）', () => {
    expect(planSessionActivation({ session: session(), tabs: [] })).toEqual({ kind: 'recreate' });
  });

  it('chat 会话不认领空 chat tab（那是用户主动打开的正常形态）', () => {
    const chatSession = session({ sessionId: 'chat-1', kind: 'chat', agentId: 'pi' });
    const emptyChatTab: Tab = {
      id: 'c1',
      scope: { kind: 'workspace', session: WS },
      title: 'Agent Chat',
      data: { kind: 'agent-chat', agentId: 'pi' },
    };
    expect(planSessionActivation({ session: chatSession, tabs: [emptyChatTab] })).toEqual({
      kind: 'recreate',
    });
  });

  it('chat 映射键命中 ⇒ 激活', () => {
    const chatSession = session({ sessionId: 'chat-1', kind: 'chat', agentId: 'pi' });
    const chatTab: Tab = {
      id: 'c1',
      scope: { kind: 'workspace', session: WS },
      title: 'Agent Chat',
      data: { kind: 'agent-chat', agentId: 'pi', sessionId: 'chat-1' },
    };
    expect(planSessionActivation({ session: chatSession, tabs: [chatTab] })).toEqual({
      kind: 'activate',
      tabId: 'c1',
    });
  });

  it('只认 terminal 的孤儿：terminal 会话不会去认领 chat tab', () => {
    const chatTab: Tab = {
      id: 'c1',
      scope: { kind: 'workspace', session: WS },
      title: 'Agent Chat',
      data: { kind: 'agent-chat', agentId: 'claude-code' },
    };
    expect(planSessionActivation({ session: session(), tabs: [chatTab] })).toEqual({
      kind: 'recreate',
    });
  });
});
