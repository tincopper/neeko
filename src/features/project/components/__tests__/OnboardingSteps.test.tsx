import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types';

import { OnboardingSteps } from '../OnboardingSteps';

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
  { id: 'gemini', name: 'Gemini', command: 'gemini', args: [], env: {}, icon: null, enabled: true },
];

const defaultProps = {
  projectName: 'neeko',
  steps: [
    {
      type: 'agent' as const,
      id: 'agent',
      title: 'Start AI Agent Session',
      description: 'Chat with Claude Code',
      icon: <span>🤖</span>,
      actionLabel: 'Open Agent',
      recommended: true,
    },
  ],
  completedSteps: [],
  onStepAction: vi.fn(),
  onStepComplete: vi.fn(),
  onDismiss: vi.fn(),
  agents,
  selectedAgentId: 'claude',
  installedMap: new Map(),
  onSelectAgent: vi.fn(),
};

describe('OnboardingSteps - agent split button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_render_agent_step_with_chevron_toggle', () => {
    render(<OnboardingSteps {...defaultProps} />);
    expect(screen.getByText('Start AI Agent Session')).toBeInTheDocument();
    expect(screen.getByTitle('Choose another agent')).toBeInTheDocument();
  });

  it('should_call_onStepAction_when_clicking_main_area_with_default_agent', () => {
    const onStepAction = vi.fn();
    render(<OnboardingSteps {...defaultProps} onStepAction={onStepAction} />);
    // Main area is the step content (not the chevron button).
    fireEvent.click(screen.getByText('Start AI Agent Session'));
    expect(onStepAction).toHaveBeenCalledWith('agent');
  });

  it('should_open_dropdown_when_clicking_chevron', async () => {
    render(<OnboardingSteps {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Choose another agent'));
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
  });

  it('should_open_dropdown_when_clicking_main_area_without_default_agent', async () => {
    const onStepAction = vi.fn();
    render(
      <OnboardingSteps {...defaultProps} selectedAgentId={null} onStepAction={onStepAction} />,
    );
    fireEvent.click(screen.getByText('Start AI Agent Session'));
    // Without a default agent, the main click should open the dropdown, not call onStepAction.
    expect(onStepAction).not.toHaveBeenCalled();
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
  });

  it('should_select_agent_from_dropdown', async () => {
    const onSelectAgent = vi.fn();
    render(<OnboardingSteps {...defaultProps} onSelectAgent={onSelectAgent} />);
    fireEvent.click(screen.getByTitle('Choose another agent'));
    fireEvent.click(await screen.findByText('Gemini'));
    expect(onSelectAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'gemini' }));
  });

  it('should_have_aria_expanded_on_toggle', () => {
    render(<OnboardingSteps {...defaultProps} />);
    const toggle = screen.getByTitle('Choose another agent');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu');
  });
});
