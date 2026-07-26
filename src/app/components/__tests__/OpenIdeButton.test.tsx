import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import OpenIdeButton from '@/app/components/OpenIdeButton';
import { useConnectionStore } from '@/features/connection/store';
import { useProjectStore } from '@/features/project/store';
import type { Project } from '@/shared/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'test-project',
    path: '/tmp/test',
    selected_agents: [],
    selected_ide: 'goland',
    git_info: null,
    active_view: 'Terminal',
    ...partial,
  } as Project;
}

describe('OpenIdeButton', () => {
  let openIdeSpy: ReturnType<typeof vi.fn>;
  let setProjectIdeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openIdeSpy = vi.fn();
    setProjectIdeSpy = vi.fn();

    // 让 getIdeCommand 走 macOS 分支，避免 jsdom 默认 platform 影响命令字符串
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });

    // Default: load_config returns empty config
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') return {};
      return undefined;
    });

    const project = makeProject();
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
      openIde: openIdeSpy,
      setProjectIde: setProjectIdeSpy,
    });
    useConnectionStore.setState({
      activeWslProject: null,
      activeRemoteProject: null,
    });
  });

  function openDropdown() {
    fireEvent.click(screen.getByTitle('Select IDE'));
  }

  it('行点击 → 调 setProjectIde（持久化），不调 openIde', async () => {
    render(<OpenIdeButton />);
    openDropdown();

    // 找到 IntelliJ IDEA 行（不是 button，是 div）
    const ideaRow = screen.getByText('IntelliJ IDEA');
    expect(ideaRow).toBeInTheDocument();
    fireEvent.click(ideaRow);

    expect(setProjectIdeSpy).toHaveBeenCalledWith('p1', 'idea');
    expect(openIdeSpy).not.toHaveBeenCalled();
  });

  it('行右侧 ▶ 按钮点击 → 调 openIde（一次性），不调 setProjectIde', () => {
    render(<OpenIdeButton />);
    openDropdown();

    const runButton = screen.getByLabelText('Open IntelliJ IDEA now');
    fireEvent.click(runButton);

    expect(openIdeSpy).toHaveBeenCalledWith({ id: 'p1', selected_ide: 'idea' });
    expect(setProjectIdeSpy).not.toHaveBeenCalled();
  });

  it('▶ 按钮点击不会冒泡触发行的 setProjectIde', () => {
    render(<OpenIdeButton />);
    openDropdown();

    const runButton = screen.getByLabelText('Open GoLand now');
    fireEvent.click(runButton);

    // 只有 openIde 被调，setProjectIde 因为 stopPropagation 没被调
    expect(openIdeSpy).toHaveBeenCalledTimes(1);
    expect(setProjectIdeSpy).toHaveBeenCalledTimes(0);
  });

  it('主按钮（左侧 IDE 名）点击 → 用当前默认 selected_ide 调 openIde', () => {
    render(<OpenIdeButton />);

    // 主按钮 title 使用展示名（GoLand）
    const mainButton = screen.getByTitle('Open in IDE (GoLand)');
    fireEvent.click(mainButton);

    expect(openIdeSpy).toHaveBeenCalledWith({ id: 'p1', selected_ide: 'goland' });
    expect(setProjectIdeSpy).not.toHaveBeenCalled();
  });

  it('selected_ide 为预设 id vscode 时主按钮显示 VS Code 图标而非 default', () => {
    const project = makeProject({ selected_ide: 'vscode' });
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
      openIde: openIdeSpy,
      setProjectIde: setProjectIdeSpy,
    });

    render(<OpenIdeButton />);

    const mainButton = screen.getByTitle('Open in IDE (VS Code)');
    const img = within(mainButton).queryByTestId('ide-icon');
    expect(img).toBeInTheDocument();
    // default.svg is black monochrome; resolved vscode icon must not be that
    expect(img?.getAttribute('src') ?? '').not.toMatch(/fill='%23000000'/);
    expect(img?.getAttribute('src') ?? '').not.toMatch(/fill="#000000"/);

    fireEvent.click(mainButton);
    // Launch uses platform command, not the stored preset id
    expect(openIdeSpy).toHaveBeenCalledWith({ id: 'p1', selected_ide: 'code' });
  });

  it('点行后下拉关闭', async () => {
    render(<OpenIdeButton />);
    openDropdown();

    expect(screen.getByText('IntelliJ IDEA')).toBeInTheDocument();

    fireEvent.click(screen.getByText('IntelliJ IDEA'));

    await waitFor(() => {
      expect(screen.queryByText('IntelliJ IDEA')).not.toBeInTheDocument();
    });
  });
});
