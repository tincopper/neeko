import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import ConversationPanel from '@/features/conversation/components/ConversationPanel';
import type { ConversationMeta } from '@/features/conversation/types';
import type { AgentConfig } from '@/features/agent/types';

const mockInvoke = vi.mocked(invoke);

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'claude-code:abc',
    nativeSessionId: 'abc',
    agentId: 'claude-code',
    title: 'Auth refactor',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 3,
    preview: 'Let me help with authentication',
    filePath: '/tmp/s.json',
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

describe('ConversationPanel', () => {
  const agents: AgentConfig[] = [
    createAgent(),
    createAgent({ id: 'codex', name: 'Codex', icon: 'codex.png', command: 'codex' }),
  ];

  const list: ConversationMeta[] = [
    createMeta({ id: 'claude-code:1', agentId: 'claude-code', title: 'Auth refactor', preview: 'auth module' }),
    createMeta({ id: 'codex:2', agentId: 'codex', title: 'Ship release', preview: 'bump version' }),
  ];

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') return list;
      return undefined;
    });
  });

  it('filters list by search query on title/preview', async () => {
    render(
      <ConversationPanel
        projectPath="/tmp/project"
        projectId="p1"
        agents={agents}
        isActive
        showToast={vi.fn()}
        onOpenConversationTab={vi.fn()}
        onResumeConversation={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Auth refactor')).toBeInTheDocument();
      expect(screen.getByText('Ship release')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ship' } });

    expect(screen.queryByText('Auth refactor')).not.toBeInTheDocument();
    expect(screen.getByText('Ship release')).toBeInTheDocument();
  });

  it('filters list by agent chip', async () => {
    render(
      <ConversationPanel
        projectPath="/tmp/project"
        projectId="p1"
        agents={agents}
        isActive
        showToast={vi.fn()}
        onOpenConversationTab={vi.fn()}
        onResumeConversation={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Ship release')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Codex/i }));

    expect(screen.queryByText('Auth refactor')).not.toBeInTheDocument();
    expect(screen.getByText('Ship release')).toBeInTheDocument();
  });

  it('shows clear-filters when nothing matches', async () => {
    render(
      <ConversationPanel
        projectPath="/tmp/project"
        projectId="p1"
        agents={agents}
        isActive
        showToast={vi.fn()}
        onOpenConversationTab={vi.fn()}
        onResumeConversation={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Auth refactor')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz-no-match' } });

    expect(screen.getByText('No matching conversations')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.getByText('Auth refactor')).toBeInTheDocument();
  });
});
