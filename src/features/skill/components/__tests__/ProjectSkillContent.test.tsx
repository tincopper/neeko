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
  selected_agents: ['claude-code'],
  avatar_color: null,
};

const mockGetProjectTagGroups = vi.hoisted(() => vi.fn());
const mockSetProjectTagGroups = vi.hoisted(() => vi.fn());
const mockImportSkillsToProject = vi.hoisted(() => vi.fn());
const mockGetSkillsForTagGroup = vi.hoisted(() => vi.fn());
const mockSetProjectAgents = vi.hoisted(() => vi.fn());
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
    setProjectAgents: (...args: unknown[]) => mockSetProjectAgents(...args),
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
  mockSetProjectAgents.mockReset();
  mockRemoveSkillFromProject.mockReset();
  mockGetProjectTagGroups.mockResolvedValue([]);
  mockSetProjectTagGroups.mockResolvedValue(undefined);
  mockRemoveSkillFromProject.mockResolvedValue(undefined);
  mockImportSkillsToProject.mockResolvedValue(0);
  mockGetSkillsForTagGroup.mockResolvedValue([]);
  mockSetProjectAgents.mockResolvedValue(undefined);
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
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-1'], project.path);
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
      activeProject: { ...project, selected_agents: [] } as never,
      projects: [{ ...project, selected_agents: [] } as never],
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
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-1'], project.path);
    });
    expect(mockImportSkillsToProject).not.toHaveBeenCalled();
  });

  it('unbinding a tag group delegates reconcile to backend', async () => {
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

    // setProjectTagGroups is called with project path for backend reconcile
    await waitFor(() => {
      expect(mockSetProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-2'], project.path);
    });
    // Frontend no longer calls remove — backend handles it
    expect(mockRemoveSkillFromProject).not.toHaveBeenCalled();
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

  it('filters disk skills by source type (import folds into local)', async () => {
    const user = userEvent.setup();
    useSkillStore.setState({
      ...useSkillStore.getState(),
      skills: [
        createManagedSkill({ id: 's-local', name: 'local-skill', source_type: 'local' }),
        createManagedSkill({ id: 's-import', name: 'import-skill', source_type: 'import' }),
        createManagedSkill({ id: 's-git', name: 'git-skill', source_type: 'git' }),
        createManagedSkill({ id: 's-ssh', name: 'market-skill', source_type: 'skillssh' }),
      ],
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
            name: 'local-skill',
            description: 'Local managed',
            path: '/p/.claude/skills/local-skill',
            managed: true,
            skill_id: 's-local',
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/local-skill' },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'import-skill',
            description: 'Imported',
            path: '/p/.claude/skills/import-skill',
            managed: true,
            skill_id: 's-import',
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/import-skill' },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'git-skill',
            description: 'From git',
            path: '/p/.claude/skills/git-skill',
            managed: true,
            skill_id: 's-git',
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/git-skill' },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'market-skill',
            description: 'From skills.sh',
            path: '/p/.claude/skills/market-skill',
            managed: true,
            skill_id: 's-ssh',
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/market-skill' },
            ],
            agent_ids: ['claude-code'],
          },
          {
            name: 'unmanaged',
            description: 'Disk only',
            path: '/p/.claude/skills/unmanaged',
            managed: false,
            skill_id: null,
            enabled: true,
            agents: [
              { agent_id: 'claude-code', enabled: true, path: '/p/.claude/skills/unmanaged' },
            ],
            agent_ids: ['claude-code'],
          },
        ];
      }
      if (cmd === 'get_project_tag_groups_cmd') return [];
      if (cmd === 'get_tag_groups') return [];
      if (cmd === 'get_managed_skills') {
        return useSkillStore.getState().skills;
      }
      return undefined;
    });

    render(<ProjectSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-local-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-git-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-unmanaged')).toBeInTheDocument();
    });

    const sourceBar = screen.getByTestId('project-skill-source-filter');
    expect(sourceBar).toBeInTheDocument();

    // Local: local + import + unmanaged
    await user.click(within(sourceBar).getByRole('button', { name: /Local/i }));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-local-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-import-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-unmanaged')).toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-git-skill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-market-skill')).not.toBeInTheDocument();
    });

    // Git
    await user.click(within(sourceBar).getByRole('button', { name: /^Git$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-git-skill')).toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-local-skill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-unmanaged')).not.toBeInTheDocument();
    });

    // skills.sh
    await user.click(within(sourceBar).getByRole('button', { name: /skills\.sh/i }));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-market-skill')).toBeInTheDocument();
      expect(screen.queryByTestId('project-skill-card-git-skill')).not.toBeInTheDocument();
    });

    // All restores
    await user.click(within(sourceBar).getByRole('button', { name: /^All$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-card-local-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-git-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-market-skill')).toBeInTheDocument();
      expect(screen.getByTestId('project-skill-card-unmanaged')).toBeInTheDocument();
    });
  });

  it('shows project target agent chips and tag groups on skill cards', async () => {
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
      expect(screen.getByTestId('project-agent-chip-claude-code')).toHaveTextContent(/Claude Code/i);
    });
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-tags-code-review')).toHaveTextContent('Backend');
    });
    // Only linked agents shown (unlinked capable agents no longer appear)
    expect(screen.queryByTestId('project-skill-agent-code-review-codex')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-skill-agent-code-review-claude-code')).toHaveAttribute(
      'data-target',
      'true',
    );
  });

  it('only shows linked agents on skill cards, not unlinked capable agents', async () => {
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

    // Linked agent still shown
    await waitFor(() => {
      expect(screen.getByTestId('project-skill-agent-code-review-claude-code')).toBeInTheDocument();
    });
    // Unlinked capable agent no longer shown on card
    expect(screen.queryByTestId('project-skill-agent-code-review-codex')).not.toBeInTheDocument();
  });

  it('can toggle project target agent from chips in the Projects skills header', async () => {
    const user = userEvent.setup();
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      activeProject: { ...project, selected_agents: [] } as never,
      projects: [{ ...project, selected_agents: [] } as never],
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
      expect(screen.getByTestId('project-agent-chip-codex')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('project-agent-chip-codex'));

    await waitFor(() => {
      expect(mockSetProjectAgents).toHaveBeenCalledWith('proj-1', ['codex']);
    });
    expect(useProjectStore.getState().activeProject?.selected_agents).toEqual(['codex']);
  });

  it('excludes agents without a skill path from project target chips', async () => {
    const user = userEvent.setup();
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      activeProject: { ...project, selected_agents: [] } as never,
      projects: [{ ...project, selected_agents: [] } as never],
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

    await waitFor(() => {
      expect(screen.getByTestId('project-agent-chip-codex')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('project-agent-chip-claude-code')).not.toBeInTheDocument();
  });
});
