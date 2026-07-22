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
  selected_agent: 'claude-code',
  avatar_color: null,
};

const mockGetProjectTagGroups = vi.hoisted(() => vi.fn());
const mockSetProjectTagGroups = vi.hoisted(() => vi.fn());
const mockImportSkillsToProject = vi.hoisted(() => vi.fn());
const mockGetSkillsForTagGroup = vi.hoisted(() => vi.fn());
const mockSetProjectAgent = vi.hoisted(() => vi.fn());
const mockRemoveSkillFromProject = vi.hoisted(() => vi.fn());

vi.mock('@/features/skill/api/skillApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/skillApi')>();
  return {
    ...actual,
    getProjectTagGroups: (...args: unknown[]) => mockGetProjectTagGroups(...args),
    setProjectTagGroups: (...args: unknown[]) => mockSetProjectTagGroups(...args),
    importSkillsToProject: (...args: unknown[]) => mockImportSkillsToProject(...args),
    getSkillsForTagGroup: (...args: unknown[]) => mockGetSkillsForTagGroup(...args),
    removeSkillFromProject: (...args: unknown[]) => mockRemoveSkillFromProject(...args),
  };
});

vi.mock('@/features/agent/api/agentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent/api/agentApi')>();
  return {
    ...actual,
    setProjectAgent: (...args: unknown[]) => mockSetProjectAgent(...args),
  };
});

beforeEach(() => {
  useSkillStore.setState({
    ...initialSkillState,
    skills: [createManagedSkill({ id: 's1', name: 'code-review' })],
    tagGroups: [
      createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 4 }),
      createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 2 }),
    ],
    projectTagGroups: [],
    projectBindingsLoading: false,
  });
  useProjectStore.setState({
    activeProjectId: 'proj-1',
    activeProject: project as never,
    projects: [project as never],
  });
  mockInvoke.mockReset();
  mockGetProjectTagGroups.mockReset();
  mockSetProjectTagGroups.mockReset();
  mockImportSkillsToProject.mockReset();
  mockGetSkillsForTagGroup.mockReset();
  mockSetProjectAgent.mockReset();
  mockRemoveSkillFromProject.mockReset();
  mockGetProjectTagGroups.mockResolvedValue([]);
  mockSetProjectTagGroups.mockResolvedValue(undefined);
  mockRemoveSkillFromProject.mockResolvedValue(undefined);
  mockImportSkillsToProject.mockResolvedValue(0);
  mockGetSkillsForTagGroup.mockResolvedValue([]);
  mockSetProjectAgent.mockResolvedValue(undefined);
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_agents') {
      return [
        {
          id: 'claude-code',
          name: 'Claude Code',
          icon: 'claude-code.png',
          enabled: true,
          command: 'claude',
          skill_path: '.claude/skills',
        },
      ];
    }
    if (cmd === 'get_tag_groups') {
      return [
        createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 4 }),
        createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 2 }),
      ];
    }
    if (cmd === 'get_managed_skills')
      return [createManagedSkill({ id: 's1', name: 'code-review' })];
    if (cmd === 'get_project_skills_cmd') return [];
    if (cmd === 'get_project_tag_groups_cmd') return mockGetProjectTagGroups();
    if (cmd === 'set_project_tag_groups_cmd') return mockSetProjectTagGroups();
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

  it('shows empty bound tag groups section', async () => {
    mockGetProjectTagGroups.mockResolvedValue([]);
    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-groups-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('bound-tag-groups-empty')).toBeInTheDocument();
    expect(screen.getByTestId('bound-tag-groups-manage')).toBeInTheDocument();
  });

  it('renders bound tag groups from store after load', async () => {
    const bound = [createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 4 })];
    mockGetProjectTagGroups.mockResolvedValue(bound);

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-group-tg-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('bound-tag-group-tg-1')).toHaveTextContent('Backend');
    expect(screen.getByTestId('bound-tag-group-tg-1')).toHaveTextContent('4');
    expect(screen.queryByTestId('bound-tag-groups-empty')).not.toBeInTheDocument();
  });

  it('opens BindTagGroupsDialog from Manage and syncs group skills to project target agent only', async () => {
    const user = userEvent.setup();
    mockGetSkillsForTagGroup.mockResolvedValue([
      createManagedSkill({ id: 's1', name: 'code-review' }),
      createManagedSkill({ id: 's2', name: 'help' }),
    ]);
    mockGetProjectTagGroups
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 4 })]);
    mockImportSkillsToProject.mockResolvedValue(2);
    // Multiple capable agents available; sync must use project.selected_agent only
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
            skill_path: '.codex/skills',
          },
        ];
      }
      if (cmd === 'get_tag_groups') {
        return [
          createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 4 }),
          createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 2 }),
        ];
      }
      if (cmd === 'get_managed_skills') {
        return [createManagedSkill({ id: 's1', name: 'code-review' })];
      }
      if (cmd === 'get_project_skills_cmd') return [];
      if (cmd === 'get_project_tag_groups_cmd') return mockGetProjectTagGroups();
      if (cmd === 'set_project_tag_groups_cmd') return mockSetProjectTagGroups();
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-groups-manage')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('bound-tag-groups-manage'));
    const dialog = await screen.findByTestId('bind-tag-groups-dialog');
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByText('Backend'));
    await user.click(within(dialog).getByRole('button', { name: /Bind 1 group/i }));

    await waitFor(() => {
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-1']);
    });
    await waitFor(() => {
      expect(mockGetSkillsForTagGroup).toHaveBeenCalledWith('tg-1');
      expect(mockImportSkillsToProject).toHaveBeenCalledWith(
        project.path,
        expect.arrayContaining(['s1', 's2']),
        ['claude-code'],
      );
    });
    // Must not include other capable agents
    const importCall = mockImportSkillsToProject.mock.calls.at(-1);
    expect(importCall?.[2]).toEqual(['claude-code']);
  });

  it('saves bindings without import when project has no selected_agent', async () => {
    const user = userEvent.setup();
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      activeProject: { ...project, selected_agent: null } as never,
      projects: [{ ...project, selected_agent: null } as never],
    });
    mockGetSkillsForTagGroup.mockResolvedValue([
      createManagedSkill({ id: 's1', name: 'code-review' }),
    ]);
    mockGetProjectTagGroups.mockResolvedValue([]);

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-groups-manage')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('bound-tag-groups-manage'));
    const dialog = await screen.findByTestId('bind-tag-groups-dialog');
    await user.click(within(dialog).getByText('Backend'));
    await user.click(within(dialog).getByRole('button', { name: /Bind 1 group/i }));

    await waitFor(() => {
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-1']);
    });
    expect(mockImportSkillsToProject).not.toHaveBeenCalled();
  });

  it('unbinding a tag group removes its exclusive skills from project agent dirs', async () => {
    const user = userEvent.setup();
    const boundGroups = [
      createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 }),
      createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 1 }),
    ];
    useSkillStore.setState({
      projectTagGroups: boundGroups,
      tagGroups: boundGroups,
    });
    mockGetProjectTagGroups.mockResolvedValue(boundGroups);
    mockGetSkillsForTagGroup.mockImplementation(async (id: string) => {
      if (id === 'tg-1') return [createManagedSkill({ id: 's1', name: 'code-review' })];
      if (id === 'tg-2') return [createManagedSkill({ id: 's2', name: 'help' })];
      return [];
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
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
            path: '/p/.claude/skills/help',
            managed: true,
            skill_id: 's2',
            enabled: true,
            agents: [{ agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/help' }],
            agent_ids: ['claude-code'],
          },
        ];
      }
      if (cmd === 'get_project_tag_groups_cmd') return mockGetProjectTagGroups();
      if (cmd === 'get_tag_groups') return boundGroups;
      if (cmd === 'get_managed_skills') {
        return [
          createManagedSkill({ id: 's1', name: 'code-review' }),
          createManagedSkill({ id: 's2', name: 'help' }),
        ];
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-group-tg-1')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('bound-tag-groups-manage'));
    const dialog = await screen.findByTestId('bind-tag-groups-dialog');
    // Uncheck Backend (already bound) — leave only Frontend
    await user.click(within(dialog).getByText('Backend'));
    await user.click(within(dialog).getByRole('button', { name: /Bind 1 group/i }));

    await waitFor(() => {
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-2']);
    });
    await waitFor(() => {
      expect(mockRemoveSkillFromProject).toHaveBeenCalledWith(
        project.path,
        'code-review',
        ['claude-code'],
        's1',
      );
    });
    // help still bound via Frontend — must not be removed
    expect(mockRemoveSkillFromProject).not.toHaveBeenCalledWith(
      project.path,
      'help',
      expect.anything(),
      expect.anything(),
    );
  });

  it('filters disk skills by bound tag group chip', async () => {
    const user = userEvent.setup();
    mockGetProjectTagGroups.mockResolvedValue([
      createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 }),
      createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 1 }),
    ]);
    mockGetSkillsForTagGroup.mockImplementation(async (id: string) => {
      if (id === 'tg-1') return [createManagedSkill({ id: 's1', name: 'code-review' })];
      if (id === 'tg-2') return [createManagedSkill({ id: 's2', name: 'help' })];
      return [];
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
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
            path: '/p/.claude/skills/help',
            managed: true,
            skill_id: 's2',
            enabled: true,
            agents: [{ agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/help' }],
            agent_ids: ['claude-code'],
          },
        ];
      }
      if (cmd === 'get_project_tag_groups_cmd') return mockGetProjectTagGroups();
      if (cmd === 'get_tag_groups') {
        return [
          createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 }),
          createTagGroup({ id: 'tg-2', name: 'Frontend', skill_count: 1 }),
        ];
      }
      if (cmd === 'get_managed_skills') return [];
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-help')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('bound-tag-group-tg-1')).toBeInTheDocument();
    });

    // Filter to Backend → only code-review
    await user.click(within(screen.getByTestId('bound-tag-group-tg-1')).getByRole('button'));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-code-review')).toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-help')).not.toBeInTheDocument();
    });

    // All groups clears filter
    await user.click(screen.getByTestId('bound-tag-group-filter-all'));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-help')).toBeInTheDocument();
    });
  });

  it('shows project target agent and tag groups on skill cards', async () => {
    mockGetProjectTagGroups.mockResolvedValue([
      createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 }),
    ]);
    mockGetSkillsForTagGroup.mockResolvedValue([
      createManagedSkill({ id: 's1', name: 'code-review' }),
    ]);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
            skill_path: '.codex/skills',
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
        ];
      }
      if (cmd === 'get_project_tag_groups_cmd') return mockGetProjectTagGroups();
      if (cmd === 'get_tag_groups') {
        return [createTagGroup({ id: 'tg-1', name: 'Backend', skill_count: 1 })];
      }
      if (cmd === 'get_managed_skills') {
        return [createManagedSkill({ id: 's1', name: 'code-review' })];
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-target-agent')).toHaveTextContent(/Claude Code/i);
    });
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-tags-code-review')).toHaveTextContent('Backend');
    });
    // Unlinked capable agent shown for stock management (add)
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-agent-code-review-codex')).toHaveAttribute(
        'data-linked',
        'false',
      );
    });
    expect(screen.getByTestId('project-skill-agent-code-review-claude-code')).toHaveAttribute(
      'data-target',
      'true',
    );
  });

  it('adds an unlinked agent to an existing project skill via import', async () => {
    const user = userEvent.setup();
    mockGetProjectTagGroups.mockResolvedValue([]);
    mockImportSkillsToProject.mockResolvedValue(1);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
            skill_path: '.codex/skills',
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
        ];
      }
      if (cmd === 'get_project_tag_groups_cmd') return [];
      if (cmd === 'get_managed_skills') {
        return [createManagedSkill({ id: 's1', name: 'code-review' })];
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-agent-code-review-codex')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('project-skill-agent-code-review-codex'));

    await waitFor(() => {
      expect(mockImportSkillsToProject).toHaveBeenCalledWith(project.path, ['s1'], ['codex']);
    });
  });

  it('can set project target agent from the Projects skills header', async () => {
    const user = userEvent.setup();
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      activeProject: { ...project, selected_agent: null } as never,
      projects: [{ ...project, selected_agent: null } as never],
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: '.claude/skills',
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
            skill_path: '.codex/skills',
          },
        ];
      }
      if (cmd === 'get_project_skills_cmd') return [];
      if (cmd === 'get_project_tag_groups_cmd') return [];
      if (cmd === 'get_managed_skills') return [];
      if (cmd === 'get_tag_groups') return [];
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-target-agent-missing')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('project-target-agent-missing'));
    await user.click(await screen.findByTestId('set-target-agent-codex'));

    await waitFor(() => {
      expect(mockSetProjectAgent).toHaveBeenCalledWith('proj-1', 'codex');
    });
    expect(useProjectStore.getState().activeProject?.selected_agent).toBe('codex');
  });

  it('excludes agents without a skill path from project target choices', async () => {
    const user = userEvent.setup();
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      activeProject: { ...project, selected_agent: null } as never,
      projects: [{ ...project, selected_agent: null } as never],
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_agents') {
        return [
          {
            id: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code.png',
            enabled: true,
            command: 'claude',
            skill_path: null,
          },
          {
            id: 'codex',
            name: 'Codex',
            icon: 'codex.png',
            enabled: true,
            command: 'codex',
            skill_path: '.codex/skills',
          },
        ];
      }
      if (cmd === 'get_project_skills_cmd') return [];
      if (cmd === 'get_project_tag_groups_cmd') return [];
      if (cmd === 'get_managed_skills') return [];
      if (cmd === 'get_tag_groups') return [];
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await user.click(await screen.findByTestId('project-target-agent-missing'));
    expect(await screen.findByTestId('set-target-agent-codex')).toBeInTheDocument();
    expect(screen.queryByTestId('set-target-agent-claude-code')).not.toBeInTheDocument();
  });
});
