import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types';

import { QuickActionBar } from '../QuickActionBar';

const agents: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    icon: null,
    enabled: true,
  },
];

const defaultProps = {
  steps: [
    {
      type: 'default' as const,
      id: 'terminal',
      title: 'Open Terminal',
      description: '',
      icon: <span>🖥</span>,
      actionLabel: 'Resume Terminal',
    },
    {
      type: 'agent' as const,
      id: 'agent',
      title: 'Start AI Agent Session',
      description: '',
      icon: <span>🤖</span>,
      actionLabel: 'Open Agent',
    },
    {
      type: 'tag' as const,
      id: 'tags',
      title: 'Bind Tag Groups',
      description: '',
      icon: <span>🏷</span>,
      actionLabel: 'Assign Tags',
    },
  ],
  onStepAction: vi.fn(),
  onExpand: vi.fn(),
  agents,
  selectedAgentId: 'claude',
  installedMap: new Map(),
  onSelectAgent: vi.fn(),
};

describe('QuickActionBar', () => {
  it('should_render_action_labels', () => {
    render(<QuickActionBar {...defaultProps} />);
    expect(screen.getByText('Resume Terminal')).toBeInTheDocument();
    expect(screen.getByText('Open Agent')).toBeInTheDocument();
    expect(screen.getByText('Assign Tags')).toBeInTheDocument();
  });

  it('should_call_onStepAction_when_clicking_an_action', () => {
    const onStepAction = vi.fn();
    render(<QuickActionBar {...defaultProps} onStepAction={onStepAction} />);
    fireEvent.click(screen.getByText('Resume Terminal'));
    expect(onStepAction).toHaveBeenCalledWith('terminal');
  });

  it('should_call_onExpand_when_clicking_show_steps', () => {
    const onExpand = vi.fn();
    render(<QuickActionBar {...defaultProps} onExpand={onExpand} />);
    fireEvent.click(screen.getByText('Show steps'));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('should_open_agent_dropdown_when_clicking_agent_toggle', async () => {
    render(<QuickActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Choose another agent'));
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
  });
});
