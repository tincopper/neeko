import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ConversationList from '@/features/conversation/components/ConversationList';
import ConversationListSkeleton from '@/features/conversation/components/ConversationListSkeleton';
import type { ConversationMeta } from '@/features/conversation/types';

describe('ConversationListSkeleton', () => {
  it('renders accessible busy status', () => {
    render(<ConversationListSkeleton rows={4} />);
    expect(screen.getByRole('status', { name: 'Loading conversations' })).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});

describe('ConversationList fishbone loading', () => {
  const noop = () => {};

  it('shows skeleton while loading with no rows', () => {
    render(
      <ConversationList
        conversations={[]}
        agents={[]}
        loading
        onView={noop}
        onResume={noop}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading conversations' })).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });

  it('shows skeleton while refreshing empty list (cold cache)', () => {
    render(
      <ConversationList
        conversations={[]}
        agents={[]}
        loading={false}
        refreshing
        onView={noop}
        onResume={noop}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading conversations' })).toBeInTheDocument();
  });

  it('shows empty state only when not loading and not refreshing', () => {
    render(
      <ConversationList
        conversations={[]}
        agents={[]}
        loading={false}
        refreshing={false}
        onView={noop}
        onResume={noop}
      />,
    );
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('keeps rows visible while refreshing', () => {
    const rows: ConversationMeta[] = [
      {
        id: 'claude-code:1',
        nativeSessionId: '1',
        agentId: 'claude-code',
        title: 'Hello',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        preview: 'hi',
        filePath: '/tmp/a',
        projectPath: '/tmp/p',
        userTitle: null,
        tags: [],
      },
    ];
    render(
      <ConversationList
        conversations={rows}
        agents={[]}
        loading={false}
        refreshing
        onView={noop}
        onResume={noop}
      />,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Updating…')).toBeInTheDocument();
  });
});
