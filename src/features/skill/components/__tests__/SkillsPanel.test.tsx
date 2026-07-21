import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSkillStore, initialSkillState } from '../../store';
import { createManagedSkill, createTagGroup } from '../../../../testing/factories';
import { invoke } from '@tauri-apps/api/core';
import SkillsPanel from '../SkillsPanel';

const mockInvoke = vi.mocked(invoke);

const mockAgentData = [
  {
    agent_id: 'opencode',
    agent_name: 'OpenCode',
    agent_icon: null,
    agent_enabled: true,
    skills: [createManagedSkill({ id: 's1', name: 'git-helper' })],
  },
];

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(mockAgentData);
});

vi.mock('@/features/skill/api/skillApi', () => ({
  getAgentSkills: () => mockInvoke('get_agent_skills_cmd').then(() => mockAgentData),
}));

describe('SkillsPanel — 导航', () => {
  it('渲染两个视图切换按钮', () => {
    render(<SkillsPanel />);
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
  });

  it('点击 Marketplace 切换 activeSkillView', () => {
    useSkillStore.setState({ activeSkillView: 'local' });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Marketplace'));
    expect(useSkillStore.getState().activeSkillView).toBe('marketplace');
  });

  it('点击 Library 切换 activeSkillView 并清除 tag', () => {
    useSkillStore.setState({
      activeSkillView: 'marketplace',
      activeTagGroupId: 'tg1',
    });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Library'));
    expect(useSkillStore.getState().activeSkillView).toBe('local');
    expect(useSkillStore.getState().activeTagGroupId).toBeNull();
  });

  it('skills 数量显示在 Library 旁边', () => {
    useSkillStore.setState({
      skills: [createManagedSkill({ id: 's1' }), createManagedSkill({ id: 's2' })],
    });
    render(<SkillsPanel />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('点击 Agents 中的 agent 设置 activeAgentId 和 activeSkillView', async () => {
    render(<SkillsPanel />);
    const agentBtn = await screen.findByText('OpenCode');
    fireEvent.click(agentBtn);
    expect(useSkillStore.getState().activeAgentId).toBe('opencode');
    expect(useSkillStore.getState().activeSkillView).toBe('agents');
  });
});

describe('SkillsPanel — Tags', () => {
  it('渲染 Tags 区域', () => {
    render(<SkillsPanel />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('tag groups 存在时渲染列表项', () => {
    useSkillStore.setState({
      tagGroups: [
        createTagGroup({ id: 'tg1', name: 'Frontend', skill_count: 3 }),
        createTagGroup({ id: 'tg2', name: 'Backend', skill_count: 1 }),
      ],
    });
    render(<SkillsPanel />);
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
  });

  it('点击 tag 设置 activeTagGroupId', () => {
    useSkillStore.setState({
      tagGroups: [createTagGroup({ id: 'tg1', name: 'Frontend' })],
    });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Frontend'));
    expect(useSkillStore.getState().activeTagGroupId).toBe('tg1');
    expect(useSkillStore.getState().activeSkillView).toBe('local');
  });

  it('再次点击已选中的 tag 取消选中', () => {
    useSkillStore.setState({
      activeTagGroupId: 'tg1',
      tagGroups: [createTagGroup({ id: 'tg1', name: 'Frontend' })],
    });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Frontend'));
    expect(useSkillStore.getState().activeTagGroupId).toBeNull();
  });

  it('可点击 + 打开创建 tag 输入框', () => {
    render(<SkillsPanel />);
    fireEvent.click(screen.getByTitle('New preset'));
    expect(screen.getByPlaceholderText(/Backend/i)).toBeInTheDocument();
  });

  it('显示 New Tag 入口', () => {
    useSkillStore.setState({ tagGroups: [] });
    render(<SkillsPanel />);
    expect(screen.getByText('New Tag')).toBeInTheDocument();
  });
});
