import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/features/agent/types';
import ConversationPanel from '@/features/conversation/components/ConversationPanel';
import type { ConversationMeta } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'pi:abc',
    nativeSessionId: 'abc',
    agentId: 'pi',
    title: 'Auth refactor',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 3,
    preview: 'auth module',
    filePath: '/tmp/s.jsonl',
    projectPath: '/tmp/project',
    userTitle: null,
    tags: [],
    supportsResume: false,
    deleteSupport: 'storage',
    ...overrides,
  };
}

const agents: AgentConfig[] = [
  {
    id: 'pi',
    name: 'Pi',
    command: 'pi',
    args: [],
    env: {},
    icon: 'pi.png',
    enabled: true,
  },
];

const rows: ConversationMeta[] = [
  createMeta({ id: 'pi:abc', title: 'Auth refactor' }),
  createMeta({ id: 'pi:def', title: 'Ship release', filePath: '/tmp/def.jsonl' }),
];

function renderPanel(onDeleteConversation: (meta: ConversationMeta) => Promise<boolean>) {
  return render(
    <ConversationPanel
      projectPath="/tmp/project"
      projectId="proj-1"
      agents={agents}
      isActive
      showToast={vi.fn()}
      onOpenConversationTab={vi.fn()}
      onResumeConversation={vi.fn(async () => undefined)}
      onDeleteConversation={onDeleteConversation}
    />,
  );
}

describe('ConversationPanel delete orchestration', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') {
        return { items: rows, total: rows.length, offset: 0, limit: rows.length, hasMore: false };
      }
      return undefined;
    });
  });

  /**
   * 删除成功 → 行消失、计数减一，**不整页刷新**（AC: R5.3）。
   *
   * 变异验证：去掉面板里的 `removeConversation(meta.id)` → 本用例红。
   */
  it('removes the row locally after a successful delete', async () => {
    const onDelete = vi.fn(async () => true);
    renderPanel(onDelete);

    const before = await screen.findAllByText('Auth refactor');
    expect(before.length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    await waitFor(() => {
      expect(screen.queryByText('Auth refactor')).not.toBeInTheDocument();
    });
    // 另一行仍在（不是清空列表）。
    expect(screen.getByText('Ship release')).toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  /**
   * 删除失败 → 行必须还在（失败不乐观移除，AC7）。
   *
   * 变异验证：把 `if (!deleted) return;` 去掉 → 本用例红。
   */
  it('keeps the row when the delete fails', async () => {
    const onDelete = vi.fn(async () => false);
    renderPanel(onDelete);

    await screen.findAllByText('Auth refactor');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Auth refactor')).toBeInTheDocument();
    expect(screen.getByText('Ship release')).toBeInTheDocument();
  });

  it('hides the delete entry when the container provides no handler', async () => {
    render(
      <ConversationPanel
        projectPath="/tmp/project"
        projectId="proj-1"
        agents={agents}
        isActive
        showToast={vi.fn()}
        onOpenConversationTab={vi.fn()}
        onResumeConversation={vi.fn(async () => undefined)}
      />,
    );

    await screen.findAllByText('Auth refactor');
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });
});
