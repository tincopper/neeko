import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DndContext,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import TabItem from '../TabItem';
import type { Tab } from '@/shared/types/tab';
import type { AgentConfig } from '@/shared/types';

function renderTabItem(
  tab: Tab,
  agents: AgentConfig[] = [],
) {
  return render(
    <DndContext>
      <SortableContext items={[tab.id]} strategy={horizontalListSortingStrategy}>
        <TabItem
          tab={tab}
          isActive
          agents={agents}
          onActivate={vi.fn()}
          onClose={vi.fn()}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('TabItem agent icon', () => {
  const terminalTab: Tab = {
    id: 'tab-1',
    title: 'claude session',
    data: {
      kind: 'terminal',
      sessionId: 'session-1',
      agentId: 'custom-agent',
      status: 'Idle',
    },
  };

  it('should_show_custom_agent_icon_when_icon_is_absolute_path', () => {
    const customPath =
      '/Users/me/Library/Application Support/com.neeko.app/agent-icons/abc.png';
    const agents: AgentConfig[] = [
      {
        id: 'custom-agent',
        name: 'My Agent',
        command: 'my-agent',
        args: [],
        env: {},
        icon: customPath,
        enabled: true,
      },
    ];

    renderTabItem(terminalTab, agents);

    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe(`asset://localhost/${customPath}`);
  });

  it('should_fall_back_to_kind_icon_when_agent_missing', () => {
    renderTabItem(terminalTab, []);

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('claude session')).toBeInTheDocument();
  });
});
