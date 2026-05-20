import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSkillStore, initialSkillState } from '../../../store/skillStore';
import { createManagedSkill, createTagGroup } from '../../../testing/factories';
import SkillsPanel from '../SkillsPanel';

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
});

// ─── Nav 导航 ────────────────────────────────────────────────────────────────

describe('SkillsPanel — 导航', () => {
  it('渲染三个视图切换按钮', () => {
    render(<SkillsPanel />);
    expect(screen.getByText('Local Skills')).toBeInTheDocument();
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Project Skills')).toBeInTheDocument();
  });

  it('点击 Marketplace 切换 activeSkillView', () => {
    useSkillStore.setState({ activeSkillView: 'local' });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Marketplace'));
    expect(useSkillStore.getState().activeSkillView).toBe('marketplace');
  });

  it('点击 Project Skills 切换 activeSkillView', () => {
    useSkillStore.setState({ activeSkillView: 'local' });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Project Skills'));
    expect(useSkillStore.getState().activeSkillView).toBe('project');
  });

  it('点击 Local Skills 切换 activeSkillView', () => {
    useSkillStore.setState({ activeSkillView: 'marketplace' });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Local Skills'));
    expect(useSkillStore.getState().activeSkillView).toBe('local');
  });

  it('skills 数量显示在 Local Skills 旁边', () => {
    useSkillStore.setState({
      skills: [createManagedSkill({ id: 's1' }), createManagedSkill({ id: 's2' })],
    });
    render(<SkillsPanel />);
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});

// ─── Tag Groups ───────────────────────────────────────────────────────────────

describe('SkillsPanel — Tag Groups', () => {
  it('渲染 Tag Groups 区域', () => {
    render(<SkillsPanel />);
    expect(screen.getByText('Tag Groups')).toBeInTheDocument();
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

  it('点击 tag group 设置 activeTagGroupId', () => {
    useSkillStore.setState({
      tagGroups: [createTagGroup({ id: 'tg1', name: 'Frontend' })],
    });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Frontend'));
    expect(useSkillStore.getState().activeTagGroupId).toBe('tg1');
  });

  it('再次点击已选中的 tag group 取消选中', () => {
    useSkillStore.setState({
      activeTagGroupId: 'tg1',
      tagGroups: [createTagGroup({ id: 'tg1', name: 'Frontend' })],
    });
    render(<SkillsPanel />);
    fireEvent.click(screen.getByText('Frontend'));
    expect(useSkillStore.getState().activeTagGroupId).toBeNull();
  });

  it('tag groups 为空时显示 "No tag groups"', () => {
    useSkillStore.setState({ tagGroups: [] });
    render(<SkillsPanel />);
    expect(screen.getByText('No tag groups')).toBeInTheDocument();
  });
});
