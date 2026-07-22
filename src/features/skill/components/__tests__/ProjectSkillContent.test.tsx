import { invoke } from '@tauri-apps/api/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedSkill, createTagGroup } from '../../../../testing/factories';
import { useProjectStore } from '../../../project/store';
import { initialSkillState, useSkillStore } from '../../store';
import ProjectSkillContent from '../ProjectSkillContent';

const mockInvoke = vi.mocked(invoke);

const project = {
  id: 'proj-1',
  name: 'go-demo',
  path: '/Users/tomgs/workspaces/go_space/go-demo',
  environment: { type: 'Local' as const },
  git_info: null,
  terminal: { id: 't1', pid: null, status: 'Idle' as const },
  agent_id: null,
  avatar_color: null,
};

beforeEach(() => {
  useSkillStore.setState({
    ...initialSkillState,
    skills: [createManagedSkill({ id: 's1', name: 'code-review' })],
    tagGroups: [createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 })],
  });
  useProjectStore.setState({
    activeProjectId: 'proj-1',
    activeProject: project as never,
    projects: [project as never],
  });
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_agents') {
      return [
        {
          id: 'claude-code',
          name: 'Claude Code',
          icon: 'claude-code.png',
          enabled: true,
          command: 'claude',
        },
      ];
    }
    if (cmd === 'get_tag_groups') return [createTagGroup({ id: 'tg-1', name: 'Backend' })];
    if (cmd === 'get_managed_skills') return [createManagedSkill({ id: 's1', name: 'code-review' })];
    if (cmd === 'get_project_skills_cmd') return [];
    return undefined;
  });
});

describe('ProjectSkillContent', () => {
  it('shows empty state when no project selected', () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    render(<ProjectSkillContent setDialog={vi.fn()} />);
    expect(screen.getByText(/No project selected/i)).toBeInTheDocument();
  });

  it('shows empty project skills with add CTA', async () => {
    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No skills in this project/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add from Library/i })).toBeInTheDocument();
    expect(screen.getByText(/No skills in this project/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add from Library/i })).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 0/i)).toBeInTheDocument();
  });

  it('opens import dialog from Add Skill', async () => {
    const user = userEvent.setup();
    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-empty')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /Add Skill/i })[0]);
    const dialog = await screen.findByTestId('import-to-project-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Add from Library/i);
    expect(dialog).toHaveTextContent(/Target/i);
  });

  it('renders scanned project skills as cards', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
          },
        ];
      }
      if (cmd === 'get_project_skills_cmd') {
        return [
          {
            name: 'code-review',
            description: 'Strict review',
            path: '/Users/tomgs/workspaces/go_space/go-demo/.claude/skills/code-review',
            managed: true,
            skill_id: 's1',
            enabled: true,
            agents: [
              {
                agent_id: 'claude-code',
                enabled: true,
                path: '/Users/tomgs/workspaces/go_space/go-demo/.claude/skills/code-review',
              },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'help',
            description: 'Help skill',
            path: '/Users/tomgs/workspaces/go_space/go-demo/.codex/skills/help',
            managed: true,
            skill_id: 's2',
            enabled: true,
            agents: [
              {
                agent_id: 'codex',
                enabled: true,
                path: '/Users/tomgs/workspaces/go_space/go-demo/.codex/skills/help',
              },
            ],
            agent_ids: ['codex'],
          },
        ];
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
    });
    expect(screen.getByText('Strict review')).toBeInTheDocument();
    expect(screen.getAllByText(/In library/i).length).toBeGreaterThan(0);
    // no file-count badge next to title
    const card = screen.getByTestId('project-skill-card-code-review');
    expect(card.querySelector('.lucide-file-text')).toBeNull();
  });

  it('filters skills by agent', async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
          },
        ];
      }
      if (cmd === 'get_project_skills_cmd') {
        return [
          {
            name: 'code-review',
            description: 'Strict review',
            path: '/p/.claude/skills/code-review',
            managed: true,
            skill_id: 's1',
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/code-review' },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'help',
            description: 'Help skill',
            path: '/p/.codex/skills/help',
            managed: true,
            skill_id: 's2',
            enabled: true,
            agents: [{ agent_id: 'codex', enabled: true, path: '/p/.codex/skills/help' }],
            agent_ids: ['codex'],
          },
        ];
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-help')).toBeInTheDocument();
    });

    const agentFilter = screen.getByRole('group', { name: /Filter by agent/i });
    await user.click(within(agentFilter).getByRole('button', { name: 'Claude Code' }));
    expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
    expect(screen.queryByTestId('project-skill-card-help')).not.toBeInTheDocument();

    await user.click(within(agentFilter).getByRole('button', { name: 'All agents' }));
    expect(screen.getByTestId('project-skill-card-help')).toBeInTheDocument();
  });
});
