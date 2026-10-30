import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/features/agent/types';
import ConversationItem from '@/features/conversation/components/ConversationItem';
import type { ConversationMeta } from '@/features/conversation/types';

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'claude-code:abc123',
    nativeSessionId: 'abc123',
    agentId: 'claude-code',
    title: 'Refactoring the auth module',
    startedAt: Date.now() - 3600000,
    updatedAt: Date.now() - 1800000,
    messageCount: 12,
    preview: 'Let me help you refactor the authentication module to use the new API...',
    filePath: '/tmp/project/.neeko/sessions/claude-code/abc123.json',
    projectPath: '/tmp/project',
    userTitle: null,
    tags: [],
    supportsResume: true,
    ...overrides,
  };
}

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    icon: 'claude-code.png',
    enabled: true,
    ...overrides,
  };
}

describe('ConversationItem', () => {
  it('renders agent icon and name', () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('renders title and message count', () => {
    const meta = createMeta({ title: 'Refactoring the auth module', messageCount: 12 });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    expect(screen.getByText('Refactoring the auth module')).toBeInTheDocument();
    expect(screen.getByText('12 msgs')).toBeInTheDocument();
  });

  it('applies active left-border styling when active', () => {
    const meta = createMeta();
    const agents = [createAgent()];
    render(
      <ConversationItem meta={meta} agents={agents} active onView={vi.fn()} onResume={vi.fn()} />,
    );

    const row = screen.getByRole('button', { name: /Refactoring/ });
    expect(row).toHaveClass('border-l-accent-blue');
  });

  it('opens View when the whole row is clicked', () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Refactoring/ }));
    expect(onView).toHaveBeenCalledWith(meta);
  });

  it('calls onResume when Resume button is clicked', () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    fireEvent.click(screen.getByTitle('Resume'));
    expect(onResume).toHaveBeenCalledWith(meta);
  });

  it('hides Resume when supportsResume is false', () => {
    const meta = createMeta({ supportsResume: false });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    expect(screen.queryByTitle('Resume')).not.toBeInTheDocument();
    expect(screen.getByTitle('View')).toBeInTheDocument();
  });

  it('hides Resume when supportsResume is undefined (legacy payload)', () => {
    const meta = createMeta({ supportsResume: undefined });
    const agents = [createAgent()];

    render(<ConversationItem meta={meta} agents={agents} onView={vi.fn()} onResume={vi.fn()} />);

    expect(screen.queryByTitle('Resume')).not.toBeInTheDocument();
  });

  it('calls onView when View button is clicked', () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    fireEvent.click(screen.getByTitle('View'));
    expect(onView).toHaveBeenCalledWith(meta);
  });

  it('falls back to agentId when agent is not found in agents list', () => {
    const meta = createMeta({ agentId: 'unknown-agent' });
    const agents: AgentConfig[] = [];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    expect(screen.getByText('unknown-agent')).toBeInTheDocument();
  });

  /**
   * 「Open in Agent Chat」的显隐由**唯一真相**（后端 `agent_chat_supports_resume`，
   * 由容器层算好并按 `canChatResume` 下传）决定。
   *
   * 变异验证：条件退回到只看 `onChatResume && nativeSessionId` → 第一条用例红
   *（claude-code 这类 chat 侧没实现的 agent 又出现死入口）。
   */
  it('hides Open in Agent Chat when the agent cannot resume into chat', () => {
    const meta = createMeta({ agentId: 'claude-code' });
    const agents = [createAgent()];

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={vi.fn()}
        onResume={vi.fn()}
        onChatResume={vi.fn()}
        canChatResume={() => false}
      />,
    );

    expect(screen.queryByTitle('Open in Agent Chat')).not.toBeInTheDocument();
    // 原生 CLI resume 不受影响（R3.4：不做「悄悄消失」）。
    expect(screen.getByTitle('Resume')).toBeInTheDocument();
  });

  it('shows Open in Agent Chat when the agent supports chat resume', () => {
    const meta = createMeta({ agentId: 'pi' });
    const agents = [createAgent({ id: 'pi', name: 'Pi' })];
    const onChatResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={vi.fn()}
        onResume={vi.fn()}
        onChatResume={onChatResume}
        canChatResume={(id) => id === 'pi'}
      />,
    );

    fireEvent.click(screen.getByTitle('Open in Agent Chat'));
    expect(onChatResume).toHaveBeenCalledWith(meta);
  });

  /** 能力未知（未传 `canChatResume`）= 不显入口：宁缺不错。 */
  it('hides Open in Agent Chat when the capability is unknown', () => {
    render(
      <ConversationItem
        meta={createMeta()}
        agents={[createAgent()]}
        onView={vi.fn()}
        onResume={vi.fn()}
        onChatResume={vi.fn()}
      />,
    );

    expect(screen.queryByTitle('Open in Agent Chat')).not.toBeInTheDocument();
  });

  /**
   * **两个正交的轴**：Agent Chat 只要「有原生会话 id + chat 侧能恢复」，
   * 不需要 CLI 能 `--resume`（`meta.supportsResume`）。
   *
   * 变异验证：把 chat 按钮挪回 `meta.supportsResume === true` 的 gate 里 → 本用例红；
   * 真机上表现为「chat 能恢复、CLI 不能恢复」的 agent 永远没有入口（静默缺失）。
   */
  it('shows Open in Agent Chat even when the CLI cannot resume', () => {
    const meta = createMeta({ agentId: 'pi', supportsResume: false });
    const agents = [createAgent({ id: 'pi', name: 'Pi' })];

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={vi.fn()}
        onResume={vi.fn()}
        onChatResume={vi.fn()}
        canChatResume={(id) => id === 'pi'}
      />,
    );

    expect(screen.getByTitle('Open in Agent Chat')).toBeInTheDocument();
    // 原生 CLI resume 仍按 conversation 侧能力显隐（R3.4）。
    expect(screen.queryByTitle('Resume')).not.toBeInTheDocument();
  });

  it("shows 'just now' for very recent conversations", () => {
    const meta = createMeta({ startedAt: Date.now() - 1000, updatedAt: Date.now() - 1000 });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(<ConversationItem meta={meta} agents={agents} onView={onView} onResume={onResume} />);

    expect(screen.getByText('just now')).toBeInTheDocument();
  });
});
