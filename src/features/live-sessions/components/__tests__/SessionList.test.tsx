import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import type { SessionState, SessionView } from '@/shared/types/liveSessions';
import { DEFAULT_AGENT_ICON, getAgentIconSrc } from '@/shared/utils/agents';

import SessionList from '../SessionList';

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
    hasUserInput: true,
    ...overrides,
  };
}

function agentIconSrc(container: HTMLElement): string | null {
  // 图标是装饰性的（`alt=""`），没有可访问角色可查 —— 同 `AgentRailRow.test` 的 img 断言范式
  // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

const HIDDEN_SIDEBAR_STATES: SessionState[] = ['ready', 'stopped'];
const VISIBLE_SIDEBAR_STATES: SessionState[] = ['running', 'awaitingApproval', 'failed'];

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

  it.each(HIDDEN_SIDEBAR_STATES)('无需关注的状态（%s）省略状态点，只保留相对时间', (state) => {
    render(<SessionList sessions={[session({ sessionId: 's1', state })]} />);
    const meta = screen.getByTestId('session-row-meta');
    expect(meta).toHaveTextContent('1m');
    expect(within(meta).queryByRole('img')).not.toBeInTheDocument();
  });

  it.each(VISIBLE_SIDEBAR_STATES)('需注意状态（%s）仍显示状态点', (state) => {
    render(<SessionList sessions={[session({ sessionId: 's1', state })]} />);
    expect(screen.getByRole('img')).toHaveAttribute('data-session-state', state);
    expect(screen.getByTestId('session-row-meta')).toHaveTextContent('1m');
  });

  it('时间无法解析且无需关注状态 ⇒ 不渲染空的元信息槽', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', state: 'ready', updatedAt: 'not-a-date' })]}
      />,
    );
    expect(screen.queryByTestId('session-row-meta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-row-actions')).not.toBeInTheDocument();
  });

  it.each(VISIBLE_SIDEBAR_STATES)('时间无法解析但 %s ⇒ 状态点仍可见', (state) => {
    render(
      <SessionList sessions={[session({ sessionId: 's1', state, updatedAt: 'not-a-date' })]} />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('data-session-state', state);
    expect(screen.getByTestId('session-row-meta')).not.toHaveTextContent('1m');
  });

  it('纯 shell 会话（agentId=null）回落 cli.svg', () => {
    const { container } = render(<SessionList sessions={[session({ sessionId: 's1' })]} />);
    // 小图会被 Vite 内联成 data URI，所以比的是「兜底资源本身」而不是文件名
    expect(agentIconSrc(container)).toBe(getAgentIconSrc(DEFAULT_AGENT_ICON));
  });

  it('占位标签照常渲染：渲染层不再判断「有没有名字」，也不编兜底', () => {
    // wire 契约：`title` 永远非空（无真标题时后端给身份标签）。渲染层若再判一次空，
    // 就会多出第二份「有没有名字」的判据 —— 那是后端的影子副本（红线 17）。
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
        sessions={[session({ sessionId: 's1', title: 'pi · neeko', titleSource: 'placeholder' })]}
      />,
    );

    // agent 身份仍然只有图标这一个出口（标题里不重复 agent 名）
    expect(agentIconSrc(container)).toBeTruthy();
    expect(screen.getByText('pi · neeko')).toBeInTheDocument();
    // 行仍在：状态点 + 时间照常
    expect(screen.getByRole('img')).toHaveAttribute('data-session-state', 'running');
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

  it('超过一页折叠，点「显示更多」**每次只再放出同样多条**（不是一次全放开）', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({ sessionId: `s${i}`, title: `会话 ${i}` }),
    );
    render(<SessionList sessions={sessions} maxRows={2} />);

    expect(screen.getByText('会话 0')).toBeInTheDocument();
    expect(screen.queryByText('会话 2')).not.toBeInTheDocument();

    // 一页 2 条：第一次显示更多 ⇒ 4 条可见
    fireEvent.click(screen.getByText('显示更多（还有 3 条）'));
    expect(screen.getByText('会话 3')).toBeInTheDocument();
    expect(screen.queryByText('会话 4')).not.toBeInTheDocument();

    // 第二次 ⇒ 5 条全在，按钮消失
    fireEvent.click(screen.getByText('显示更多（还有 1 条）'));
    expect(screen.getByText('会话 4')).toBeInTheDocument();
    expect(screen.queryByText(/显示更多/)).not.toBeInTheDocument();
  });

  it('默认每页 10 条（超过才出现「显示更多」）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => session({ sessionId: `s${i}` }));
    const { unmount } = render(<SessionList sessions={ten} />);
    expect(screen.queryByText(/显示更多/)).not.toBeInTheDocument();
    unmount();

    const eleven = Array.from({ length: 11 }, (_, i) => session({ sessionId: `s${i}` }));
    render(<SessionList sessions={eleven} />);
    expect(screen.getByText('显示更多（还有 1 条）')).toBeInTheDocument();
  });

  it('新会话出现（条数增长）⇒ 回到第一页，最新的那条可见', () => {
    const early = Array.from({ length: 12 }, (_, i) =>
      session({ sessionId: `s${i}`, title: `会话 ${i}` }),
    );
    const { rerender } = render(<SessionList sessions={early} />);
    fireEvent.click(screen.getByText('显示更多（还有 2 条）'));
    expect(screen.getByText('会话 11')).toBeInTheDocument();

    // 后端按开始时间倒序：新会话排在最前
    const withNew = [session({ sessionId: 'new', title: '新会话' }), ...early];
    rerender(<SessionList sessions={withNew} />);
    expect(screen.getByText('新会话')).toBeInTheDocument();
    expect(screen.queryByText('会话 11')).not.toBeInTheDocument();
    expect(screen.getByText('显示更多（还有 3 条）')).toBeInTheDocument();
  });

  it('当前会话位于后续页 ⇒ 自动纳入可见范围（否则父行让出选中但子行看不见）', () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session({ sessionId: `s${i}`, title: `会话 ${i}` }),
    );
    render(
      <SessionList
        sessions={sessions}
        maxRows={2}
        activeSession={session({ sessionId: 's11', title: '会话 11' })}
      />,
    );
    expect(screen.getByText('会话 11')).toBeInTheDocument();
  });

  it('选中行只用一个语义类表达（淡底在 CSS 里，不是中性选中底）', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: 'A' })]}
        activeSession={session({ sessionId: 's1', title: 'A' })}
      />,
    );

    // 淡底画在**整行**（`role="listitem"` 的外层）上：行尾工具栏是绝对覆盖的兄弟节点，
    // 底色若只给按钮，高亮就会在 `⋯` 前面断掉。`aria-current` 仍在按钮上 —— 那才是可交互元素。
    const shell = screen.getByRole('listitem');
    expect(shell).toHaveClass('row-current');
    // 选中行 hover 时也切到与覆盖槽一致的实底，避免工具栏下方出现另一层颜色。
    expect(shell).toHaveClass('hover:bg-bg-hover');
    // 中性选中底是父级（单元行）的通道，子行不能也用它
    expect(shell).not.toHaveClass('bg-bg-selected');
    expect(screen.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-current', 'true');
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

describe('SessionList — 行工具栏（重命名 / 删除）', () => {
  it('不传 onRename / onDelete ⇒ 不渲染工具栏（只读列表不受影响）', () => {
    render(<SessionList sessions={[session({ sessionId: 's1', title: 'A' })]} />);
    expect(screen.queryByRole('button', { name: /Session actions/ })).not.toBeInTheDocument();
  });

  it('传了能力 ⇒ 每行一个工具栏按钮（标签点名是哪条会话）', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '修复登录竞态' })]}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Session actions: 修复登录竞态' }),
    ).toBeInTheDocument();
  });

  it('双击标题进入改名态；回车提交回传新标题', () => {
    const onRename = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '旧名字' })]}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /^旧名字/ }));
    const input = screen.getByDisplayValue('旧名字');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), '新名字');
  });

  /**
   * 回归（真实 bug）：改名框的 focus effect 曾依赖 `[draft]`，每敲一个字符就重新
   * `select()` 全选 → 下一个按键覆盖整段，表现为「一输入就是选中状态，只能打出最后一个字」。
   *
   * 必须用 `userEvent.type` 逐字符输入：`fireEvent.change` 一次写完会把这个缺陷完全掩盖。
   */
  it('逐字符连续输入时不被重新全选覆盖（回归：最终只剩最后一个字）', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '旧名字' })]}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /^旧名字/ }));
    const input = screen.getByDisplayValue('旧名字') as HTMLInputElement;

    await user.type(input, '新名字', { skipClick: true });

    // 先钉住输入框里真的是完整字符串（旧实现只剩「字」），再钉住提交出去的是它。
    expect(input.value).toBe('新名字');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), '新名字');
  });

  it('改名态下按 Escape 取消：不回调，标题复原', () => {
    const onRename = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '旧名字' })]}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /^旧名字/ }));
    const input = screen.getByDisplayValue('旧名字');
    fireEvent.change(input, { target: { value: '不想要的名字' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^旧名字/ })).toBeInTheDocument();
  });

  it('提交空白标题 ⇒ 不回调（空标题不是名字）', () => {
    const onRename = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '旧名字' })]}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /^旧名字/ }));
    const input = screen.getByDisplayValue('旧名字');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('标题没改动 ⇒ 不回调（不打扰后端）', () => {
    const onRename = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '旧名字' })]}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /^旧名字/ }));
    fireEvent.keyDown(screen.getByDisplayValue('旧名字'), { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('点击行仍会激活会话（工具栏是兄弟节点，不抢行的点击）', () => {
    const onActivate = vi.fn();
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: 'A' })]}
        onActivate={onActivate}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^A/ }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
  });
});

describe('SessionList — 行尾元信息与 hover 工具栏', () => {
  it('时间 + 状态点靠行尾，hover 时淡出；工具栏绝对覆盖且不占额外 flex 列', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '修复登录竞态' })]}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const row = screen.getByRole('listitem');
    const meta = screen.getByTestId('session-row-meta');
    const actions = screen.getByTestId('session-row-actions');

    expect(row).toHaveClass('relative', 'group/session');
    expect(meta).toHaveTextContent('1m');
    expect(meta).toContainElement(screen.getByRole('img'));
    expect(meta).toHaveClass('transition-opacity', 'group-hover/session:opacity-0');
    expect(actions).toHaveClass(
      'absolute',
      'right-1.5',
      'top-1/2',
      '-translate-y-1/2',
      'opacity-0',
      'pointer-events-none',
      'group-hover/session:opacity-100',
      'group-hover/session:pointer-events-auto',
    );
    // 覆盖槽用与行 hover 一致的实底遮住底下的长标题 / 元信息，但不画圆角、阴影或额外内边距。
    expect(actions).toHaveClass('bg-bg-hover');
    expect(actions).not.toHaveClass('bg-bg-tertiary');
    expect(actions).not.toHaveClass('rounded-md');
    expect(actions).not.toHaveClass('p-0.5');
    expect(actions).not.toHaveClass('shadow-sm');
    expect(row).toHaveClass('hover:bg-bg-hover');
    expect(row).not.toHaveClass('bg-bg-hover');
    // 覆盖槽是行按钮的兄弟节点，且靠 absolute 脱离 flex 流 —— 不再为工具栏留一列。
    expect(row).toContainElement(actions);
    expect(within(actions).getByRole('button', { name: /Session actions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^修复登录竞态/ })).toHaveClass('flex-1');
  });

  it('菜单展开时动作槽保持可见，时间 + 状态点保持隐藏', async () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '修复登录竞态' })]}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const row = screen.getByRole('listitem');
    const trigger = screen.getByRole('button', { name: 'Session actions: 修复登录竞态' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    await screen.findByRole('menuitem', { name: 'Rename' });

    expect(screen.getByTestId('session-row-actions')).toHaveClass(
      'opacity-100',
      'pointer-events-auto',
    );
    expect(screen.getByTestId('session-row-meta')).toHaveClass('opacity-0');
    expect(trigger).toHaveAttribute('data-state', 'open');
    // 指针移开但菜单仍开时，行与覆盖槽同色，不留下孤立的浮块。
    expect(row).toHaveClass('bg-bg-hover');
  });

  it('键盘聚焦工具栏时动作槽浮现、元信息隐藏；移开焦点后复位', () => {
    render(
      <SessionList
        sessions={[session({ sessionId: 's1', title: '修复登录竞态' })]}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const row = screen.getByRole('listitem');
    const trigger = screen.getByRole('button', { name: 'Session actions: 修复登录竞态' });
    const actions = screen.getByTestId('session-row-actions');
    const meta = screen.getByTestId('session-row-meta');

    fireEvent.focusIn(trigger);
    expect(actions).toHaveClass('opacity-100', 'pointer-events-auto');
    expect(meta).toHaveClass('opacity-0');
    expect(row).toHaveClass('bg-bg-hover');

    fireEvent.focusOut(trigger);
    expect(actions).toHaveClass('opacity-0', 'pointer-events-none');
    expect(meta).not.toHaveClass('opacity-0');
    expect(row).not.toHaveClass('bg-bg-hover');
  });

  it('无工具栏能力时不渲染覆盖槽（只读列表仍只有时间 + 状态点）', () => {
    render(<SessionList sessions={[session({ sessionId: 's1', title: 'A' })]} />);
    expect(screen.queryByTestId('session-row-actions')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-row-meta')).toBeInTheDocument();
  });
});

describe('SessionList — 工具栏菜单的视觉契约', () => {
  it('菜单项带图标与文字；删除项单独用破坏性配色', async () => {
    const { default: SessionRowMenu } = await import('@/shared/components/SessionRowMenu');
    render(<SessionRowMenu sessionTitle="A" onRename={vi.fn()} onDelete={vi.fn()} />);

    // 菜单未展开时不渲染内容（Radix 只在打开时挂载）。
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions: A' }), {
      button: 0,
      ctrlKey: false,
    });

    const rename = await screen.findByRole('menuitem', { name: 'Rename' });
    const remove = await screen.findByRole('menuitem', { name: 'Delete' });
    // 破坏性动作单独着色 —— 这是「删除压在一组操作最下面」的视觉判据之一。
    expect(remove).toHaveClass('text-accent-red');
    expect(rename).not.toHaveClass('text-accent-red');
    // 两项都是「图标 + 文字」的排版（图标由 primitive 的 `[&_svg]` 统一尺寸）。
    expect(rename).toHaveAttribute('data-orientation', expect.anything());
  });
});
