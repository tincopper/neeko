import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SessionList from '@/shared/components/SessionList';
import { useAgentStore } from '@/shared/store/agentStore';
import type { SessionState, SessionView } from '@/shared/types/liveSessions';
import { DEFAULT_AGENT_ICON, getAgentIconSrc } from '@/shared/utils/agents';

function session(overrides: Partial<SessionView> & { sessionId: string }): SessionView {
  return {
    kind: 'terminal',
    agentId: null,
    workspaceKey: 'p1\0',
    title: 'Terminal',
    titleSource: 'placeholder',
    state: 'running' as SessionState,
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    turnCount: 0,
    ...overrides,
  };
}

function agentIconSrc(container: HTMLElement): string | null {
  // 图标是装饰性的（`alt=""`），没有可访问角色可查 —— 同 `AgentRailRow.test` 的 img 断言范式
  // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

describe('SessionList', () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: [], loading: false });
  });

  it('无会话时渲染 null（不画空壳，也不画点）', () => {
    const { container } = render(<SessionList sessions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('渲染 agent 图标 + 标题 + 相对时间 + 状态点', () => {
    useAgentStore.setState({
      agents: [
        {
          id: 'pi',
          name: 'Pi',
          command: 'pi',
          args: [],
          env: {},
          icon: 'pi.svg',
          enabled: true,
        },
      ],
      loading: false,
    });

    const { container } = render(
      <SessionList
        sessions={[session({ sessionId: 's1', agentId: 'pi', title: '修复登录跳转' })]}
      />,
    );

    expect(screen.getByText('修复登录跳转')).toBeInTheDocument();
    expect(screen.getByText('1m')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('data-session-state', 'running');
    // agent 品牌图标：不是 kind 图标，也不是文字兜底
    expect(agentIconSrc(container)).toBeTruthy();
  });

  it('纯 shell 会话（agentId=null）回落 cli.svg', () => {
    const { container } = render(<SessionList sessions={[session({ sessionId: 's1' })]} />);
    // 小图会被 Vite 内联成 data URI，所以比的是「兜底资源本身」而不是文件名
    expect(agentIconSrc(container)).toBe(getAgentIconSrc(DEFAULT_AGENT_ICON));
  });

  it('没有会话级标题时只画图标：不拿 agent 名 / 项目名占位', () => {
    useAgentStore.setState({
      agents: [
        {
          id: 'pi',
          name: 'Pi',
          command: 'pi',
          args: [],
          env: {},
          icon: 'pi.svg',
          enabled: true,
        },
      ],
      loading: false,
    });

    const { container } = render(
      <SessionList sessions={[session({ sessionId: 's1', title: '', agentId: 'pi' })]} />,
    );

    // agent 身份只剩图标这一个出口
    expect(agentIconSrc(container)).toBeTruthy();
    // 不渲染任何替它编的名字（agent 名 / 项目名都没有）
    expect(screen.queryByText('pi')).not.toBeInTheDocument();
    expect(screen.queryByText('Pi')).not.toBeInTheDocument();
    expect(screen.queryByText('neeko')).not.toBeInTheDocument();
    // 行仍在：状态点 + 时间照常
    expect(screen.getByRole('img')).toHaveAttribute('data-session-state', 'running');
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '终端会话');
  });

  it('有真标题时用主色，且不渲染任何来源徽标', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's2', title: '修复登录跳转', titleSource: 'prompt' })]}
      />,
    );

    expect(screen.getByText('修复登录跳转')).toHaveClass('text-text-primary');
    // TitleSource 不进 UI：没有任何 N/P/U 之类的来源徽标
    expect(screen.queryByText('prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('native')).not.toBeInTheDocument();
  });

  it('点击会话行回传该会话（调用方据此激活 tab）', () => {
    const onActivate = vi.fn();
    const target = session({ sessionId: 's1', title: '修复登录跳转' });
    render(<SessionList sessions={[target]} onActivate={onActivate} />);

    fireEvent.click(screen.getByText('修复登录跳转'));

    expect(onActivate).toHaveBeenCalledWith(target);
  });

  it('超过 maxRows 折叠，展开后全部渲染（原型「查看全部 N 条」）', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({ sessionId: `s${i}`, title: `会话 ${i}` }),
    );
    render(<SessionList sessions={sessions} maxRows={2} />);

    expect(screen.getByText('会话 0')).toBeInTheDocument();
    expect(screen.queryByText('会话 4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('查看全部 5 条'));
    expect(screen.getByText('会话 4')).toBeInTheDocument();

    fireEvent.click(screen.getByText('只看最近 2 条'));
    expect(screen.queryByText('会话 4')).not.toBeInTheDocument();
  });

  it('前台会话行带 aria-current（只有一行是当前）', () => {
    render(
      <SessionList
        sessions={[
          session({ sessionId: 's1', title: 'A' }),
          session({ sessionId: 's2', title: 'B' }),
        ]}
        activeSession={session({ sessionId: 's2', title: 'B' })}
      />,
    );

    expect(screen.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-current', 'false');
    expect(screen.getByRole('button', { name: /^B/ })).toHaveAttribute('aria-current', 'true');
  });

  it('前台判定按 kind + sessionId（同 id 的另一类会话不算前台）', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 'x', title: '终端会话' })]}
        activeSession={session({ sessionId: 'x', kind: 'chat', title: '聊天会话' })}
      />,
    );

    expect(screen.getByRole('button', { name: /^终端会话/ })).toHaveAttribute(
      'aria-current',
      'false',
    );
  });

  it('相对时间随节拍刷新（空闲会话不会永远停在「刚刚」）', () => {
    vi.useFakeTimers();
    try {
      const now = Date.parse('2026-10-31T10:00:00.000Z');
      vi.setSystemTime(new Date(now));
      render(
        <SessionList
          sessions={[session({ sessionId: 's1', updatedAt: new Date(now - 4_000).toISOString() })]}
        />,
      );

      expect(screen.getByText('刚刚')).toBeInTheDocument();

      // 10s 节拍推进：快照没变（组件不会因数据重渲染），标签仍须前进
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText('14s')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
