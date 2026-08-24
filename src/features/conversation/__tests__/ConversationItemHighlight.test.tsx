import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/features/agent/types';

import ConversationItem from '../components/ConversationItem';
import type { ConversationMeta } from '../types';

const meta: ConversationMeta = {
  id: 'claude-code:abc',
  nativeSessionId: 'abc',
  agentId: 'claude-code',
  title: 'Auth refactor',
  updatedAt: Date.now(),
  startedAt: Date.now(),
  messageCount: 3,
  preview: 'Let me refactor the auth module',
  filePath: '/tmp/s.json',
  projectPath: '/tmp/project',
  userTitle: null,
  tags: [],
  supportsResume: true,
};

const agents: AgentConfig[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    icon: 'claude-code.png',
    enabled: true,
  },
];

function renderItem(query?: string) {
  return render(
    <ConversationItem
      meta={meta}
      agents={agents}
      onView={vi.fn()}
      onResume={vi.fn()}
      highlightQuery={query}
    />,
  );
}

describe('ConversationItem 搜索高亮', () => {
  it('renders plain title without highlightQuery', () => {
    renderItem();
    expect(screen.getByText('Auth refactor')).toBeInTheDocument();
    expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  });

  it('highlights matching title text', () => {
    renderItem('auth');
    const mark = screen.getByRole('mark');
    expect(mark).toHaveTextContent('Auth');
  });

  it('does not crash when query does not match', () => {
    renderItem('zzz-nothing');
    expect(screen.getByText('Auth refactor')).toBeInTheDocument();
    expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  });
});
