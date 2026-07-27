import { DndContext } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import TabItem from '../TabItem';

function renderTabItem(tab: Tab, agents: AgentConfig[] = []) {
  return render(
    <DndContext>
      <SortableContext items={[tab.id]} strategy={horizontalListSortingStrategy}>
        <TabItem tab={tab} isActive agents={agents} onActivate={vi.fn()} onClose={vi.fn()} />
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
    const customPath = '/Users/me/Library/Application Support/com.neeko.app/agent-icons/abc.png';
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

    const img = screen.getByTestId('agent-icon');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', `asset://localhost/${customPath}`);
  });

  it('should_fall_back_to_kind_icon_when_agent_missing', () => {
    renderTabItem(terminalTab, []);

    expect(screen.queryByTestId('agent-icon')).not.toBeInTheDocument();
    expect(screen.getByText('claude session')).toBeInTheDocument();
  });
});

describe('TabItem close button pointer isolation', () => {
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

  it('should_call_onClose_when_close_button_clicked_in_reorderable_mode', () => {
    const onClose = vi.fn();
    render(
      <DndContext>
        <SortableContext items={[terminalTab.id]} strategy={horizontalListSortingStrategy}>
          <TabItem tab={terminalTab} isActive reorderable onActivate={vi.fn()} onClose={onClose} />
        </SortableContext>
      </DndContext>,
    );

    const closeBtn = screen.getByTitle('Close tab');
    // pointerDown on × must not start a drag; click must still close.
    fireEvent.pointerDown(closeBtn);
    fireEvent.pointerUp(closeBtn);
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('tab-1');
  });
});
