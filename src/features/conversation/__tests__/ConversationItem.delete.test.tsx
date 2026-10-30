import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/features/agent/types';
import ConversationItem from '@/features/conversation/components/ConversationItem';
import type { ConversationMeta } from '@/features/conversation/types';

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'pi:abc123',
    nativeSessionId: 'abc123',
    agentId: 'pi',
    title: 'Refactoring the auth module',
    startedAt: 0,
    updatedAt: 0,
    messageCount: 3,
    preview: '',
    filePath: '/home/u/.pi/agent/sessions/x/abc123.jsonl',
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

function renderItem(meta: ConversationMeta, onDelete?: (m: ConversationMeta) => void) {
  return render(
    <ConversationItem
      meta={meta}
      agents={agents}
      onView={vi.fn()}
      onResume={vi.fn()}
      onDelete={onDelete}
    />,
  );
}

describe('ConversationItem delete entry', () => {
  it('shows Delete for native and storage support', () => {
    renderItem(createMeta({ deleteSupport: 'native' }), vi.fn());
    expect(screen.getByTitle('Delete')).toBeInTheDocument();

    renderItem(createMeta({ id: 'pi:other', deleteSupport: 'storage' }), vi.fn());
    expect(screen.getAllByTitle('Delete')).toHaveLength(2);
  });

  /**
   * `unsupported` 与**缺失**（旧载荷）都不出入口 —— 宁缺不错。
   *
   * 变异验证：把判断改成 `deleteSupport !== 'unsupported'` → 缺失用例红；
   * 改成「总是显示」→ unsupported 用例红。
   */
  it('hides Delete for unsupported support and for legacy payloads', () => {
    renderItem(createMeta({ deleteSupport: 'unsupported' }), vi.fn());
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();

    renderItem(createMeta({ id: 'pi:legacy', deleteSupport: undefined }), vi.fn());
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    // 其它入口不受影响（不做「悄悄消失」）。
    expect(screen.getAllByTitle('View')).toHaveLength(2);
  });

  it('hides Delete when the container passes no handler', () => {
    renderItem(createMeta({ deleteSupport: 'native' }));
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('calls onDelete with the meta and does not open the viewer', () => {
    const meta = createMeta({ deleteSupport: 'native' });
    const onDelete = vi.fn();
    const onView = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByTitle('Delete'));

    expect(onDelete).toHaveBeenCalledWith(meta);
    expect(onView).not.toHaveBeenCalled();
  });
});
