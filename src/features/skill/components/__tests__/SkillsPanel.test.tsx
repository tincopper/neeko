import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSkillStore, initialSkillState } from '../../store';
import { createManagedSkill, createTagGroup } from '../../../../testing/factories';
import SkillsPanel from '../SkillsPanel';

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
});

describe('SkillsPanel — 导航', () => {
  it('渲染两个视图切换按钮', () => {
    render(<SkillsPanel />);
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Install Skills')).toBeInTheDocument();
  });

  it('点击 Install Skills 切换 activeSkillView', () => {
    useSkillStore.setState({ activeSkillView: 'local' });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Install Skills'));
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
