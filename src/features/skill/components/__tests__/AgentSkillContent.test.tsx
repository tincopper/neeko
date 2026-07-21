import { invoke } from '@tauri-apps/api/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createManagedSkill } from '../../../../testing/factories';
import { useSkillStore, initialSkillState } from '../../store';
import AgentSkillContent from '../AgentSkillContent';

const mockInvoke = vi.mocked(invoke);

const mockData = [
  {
    agent_id: 'opencode',
    agent_name: 'OpenCode',
    agent_icon: null,
    agent_enabled: true,
    agent_skill_path: '/home/user/.opencode/skills',
    skills: [
      {
        name: 'git-helper',
        description: 'Git helper',
        path: '/skills/git-helper',
        managed: true,
        skill_id: 's1',
      },
      {
        name: 'code-formatter',
        description: null,
        path: '/skills/code-formatter',
        managed: false,
        skill_id: null,
      },
    ],
  },
  {
    agent_id: 'claude-code',
    agent_name: 'Claude Code',
    agent_icon: null,
    agent_enabled: true,
    agent_skill_path: null,
    skills: [
      {
        name: 'file-organizer',
        description: 'Organizes files',
        path: '/skills/file-organizer',
        managed: true,
        skill_id: 's3',
      },
    ],
  },
];

beforeEach(() => {
  useSkillStore.setState({
    ...initialSkillState,
    activeAgentId: null,
    skills: [
      createManagedSkill({ id: 's1', name: 'git-helper' }),
      createManagedSkill({ id: 's2', name: 'extra-skill', description: 'Extra from library' }),
    ],
  });
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(mockData);
});

describe('AgentSkillContent', () => {
  it('loading 时显示 spinner', () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<AgentSkillContent setDialog={vi.fn()} />);
    const container = screen.getByTestId('agent-skill-loading');
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('activeAgentId 为 null 时显示空状态提示', async () => {
    render(<AgentSkillContent setDialog={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Select an agent/i)).toBeInTheDocument();
    });
  });

  it('渲染选中 agent 的名称和技能数', async () => {
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
    });
    // Count badge in header
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 1 managed \/ 1 synced/i)).toBeInTheDocument();
  });

  it('渲染选中 agent 的 skills 卡片', async () => {
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('git-helper')).toBeInTheDocument();
    });
    expect(screen.getByText('code-formatter')).toBeInTheDocument();
    expect(screen.getByText('Git helper')).toBeInTheDocument();
  });

  it('Synced 和 Local 徽章正确显示', async () => {
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('agent 没有 skills 时显示友好空状态与 Add Skill', async () => {
    mockInvoke.mockResolvedValue([
      {
        agent_id: 'empty-agent',
        agent_name: 'Empty Agent',
        agent_icon: null,
        agent_enabled: true,
        agent_skill_path: '/tmp/empty/skills',
        skills: [],
      },
    ]);
    useSkillStore.setState({ activeAgentId: 'empty-agent' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-skill-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No local skills found/i)).toBeInTheDocument();
    // Header + empty CTA both show Add Skill
    const addButtons = screen.getAllByRole('button', { name: /Add Skill/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('filter 到不存在的 agent 时显示空状态', async () => {
    useSkillStore.setState({ activeAgentId: 'nonexistent' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Select an agent/i)).toBeInTheDocument();
    });
  });

  it('搜索可过滤 agent skills', async () => {
    const user = userEvent.setup();
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('git-helper')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/Search agent skills/i), 'formatter');
    expect(screen.queryByText('git-helper')).not.toBeInTheDocument();
    expect(screen.getByText('code-formatter')).toBeInTheDocument();
  });

  it('点击 Add Skill 打开从库导入对话框', async () => {
    const user = userEvent.setup();
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Add Skill/i }));
    const dialog = await screen.findByTestId('import-to-agent-dialog');
    expect(within(dialog).getByText(/Add from Library/i)).toBeInTheDocument();
    // extra-skill is importable (not yet on agent)
    expect(within(dialog).getByText('extra-skill')).toBeInTheDocument();
    // git-helper already on agent — not listed
    expect(within(dialog).queryByText('git-helper')).not.toBeInTheDocument();
  });

  it('列表视图切换可用', async () => {
    const user = userEvent.setup();
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-skill-card-git-helper')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/List view/i));
    // List view still shows skill names
    expect(screen.getByText('git-helper')).toBeInTheDocument();
    expect(screen.getByText('code-formatter')).toBeInTheDocument();
  });
});
