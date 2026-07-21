import { invoke } from '@tauri-apps/api/core';
import { render, screen, waitFor } from '@testing-library/react';
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
    skills: [createManagedSkill({ id: 's1', name: 'git-helper' })],
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
    expect(screen.getByText('2 skills')).toBeInTheDocument();
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

  it('managed 和 local 徽章正确显示', async () => {
    useSkillStore.setState({ activeAgentId: 'opencode' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('managed')).toBeInTheDocument();
    });
    expect(screen.getByText('local')).toBeInTheDocument();
  });

  it('agent 没有 skills 时显示 0 skills', async () => {
    mockInvoke.mockResolvedValue([
      {
        agent_id: 'empty-agent',
        agent_name: 'Empty Agent',
        agent_icon: null,
        agent_enabled: true,
        agent_skill_path: null,
        skills: [],
      },
    ]);
    useSkillStore.setState({ activeAgentId: 'empty-agent' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('0 skills')).toBeInTheDocument();
    });
  });

  it('filter 到不存在的 agent 时显示空状态', async () => {
    useSkillStore.setState({ activeAgentId: 'nonexistent' });
    render(<AgentSkillContent setDialog={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Select an agent/i)).toBeInTheDocument();
    });
  });
});
