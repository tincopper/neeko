import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { ProjectSwitcherItem } from '../items/ProjectSwitcherItem';

const onSelectProject = vi.fn();

vi.mock('@/features/project/ProjectContext', () => ({
  useProjectActionsContext: () => ({ onSelectProject }),
}));

describe('ProjectSwitcherItem（状态栏左下角项目切换器）', () => {
  beforeEach(() => {
    onSelectProject.mockClear();
    useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });
  });

  it('无项目时不渲染', () => {
    const { container } = render(<ProjectSwitcherItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('按钮显示当前项目名（项目色点 + 名称）', () => {
    const project = createProject({ name: 'neeko' });
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
    });
    render(<ProjectSwitcherItem />);
    expect(screen.getByTestId('project-switcher-button')).toHaveTextContent('neeko');
  });

  it('点击按钮打开上拉面板：列出全部项目并标注环境，当前项高亮', () => {
    const local = createProject({ name: 'neeko' });
    const wsl = createProject({
      id: 'proj-wsl' as ProjectId,
      name: 'infra',
      environment: { type: 'Wsl', distro: 'Ubuntu-24.04' },
    });
    useProjectStore.setState({
      projects: [local, wsl],
      activeProjectId: local.id,
      activeProject: local,
    });
    render(<ProjectSwitcherItem />);

    fireEvent.click(screen.getByTestId('project-switcher-button'));
    const panel = screen.getByTestId('project-switcher-panel');
    expect(panel).toBeInTheDocument();
    // 面板内查询用 within 圈住：项目名同时出现在状态栏按钮上
    expect(within(panel).getByText('neeko')).toBeInTheDocument();
    expect(within(panel).getByText('infra')).toBeInTheDocument();
    expect(within(panel).getByText('· WSL · Ubuntu-24.04')).toBeInTheDocument();
    // 当前项高亮（aria-current）
    expect(screen.getByTestId(`project-switcher-option-${local.id}`)).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('点击其他项目 → 调 onSelectProject 并关闭面板（切换序列唯一实现在 Context 侧）', () => {
    const a = createProject({ name: 'alpha' });
    const b = createProject({ id: 'proj-b' as ProjectId, name: 'beta' });
    useProjectStore.setState({ projects: [a, b], activeProjectId: a.id, activeProject: a });
    render(<ProjectSwitcherItem />);

    fireEvent.click(screen.getByTestId('project-switcher-button'));
    fireEvent.click(screen.getByTestId('project-switcher-option-proj-b'));
    expect(onSelectProject).toHaveBeenCalledTimes(1);
    expect(onSelectProject).toHaveBeenCalledWith(b.id);
    expect(screen.queryByTestId('project-switcher-panel')).not.toBeInTheDocument();
  });

  it('点击背板关闭面板，不触发切换', () => {
    const a = createProject({ name: 'alpha' });
    useProjectStore.setState({ projects: [a], activeProjectId: a.id, activeProject: a });
    render(<ProjectSwitcherItem />);

    fireEvent.click(screen.getByTestId('project-switcher-button'));
    fireEvent.click(screen.getByLabelText('Close panel'));
    expect(screen.queryByTestId('project-switcher-panel')).not.toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it('Esc 关闭面板（document 级监听仅面板打开期间挂载）', () => {
    const a = createProject({ name: 'alpha' });
    useProjectStore.setState({ projects: [a], activeProjectId: a.id, activeProject: a });
    render(<ProjectSwitcherItem />);

    fireEvent.click(screen.getByTestId('project-switcher-button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('project-switcher-panel')).not.toBeInTheDocument();
  });
});
