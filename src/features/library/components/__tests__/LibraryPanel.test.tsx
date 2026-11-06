import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState } from '@/features/library/store/libraryStore';
import { initialSkillState, useSkillStore } from '@/features/skill/store';
import { AppProvider, VisibilityScope } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AppConfig } from '@/shared/types/settings';
import { expectNoGlobalSideEffectsOnMount } from '@/testing/mountInvariance';

import LibraryPanel from '../LibraryPanel';

// Library 子树含 SkillContent → ViewSkillDialog（只读 AppContext），真实组合根恒在
// AppProvider 内；裸渲染会抛 "must be used within AppProvider"。
const appValue = {
  config: { theme: 'dark' } as AppConfig,
  customThemes: [],
  agents: [],
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};
const render = (ui: ReactElement) => rtlRender(<AppProvider value={appValue}>{ui}</AppProvider>);

/** 常驻挂载但隐藏：`AppCenter` 的 `VisibilityScope` 就是这个形态。 */
const renderInScope = (visible: boolean) =>
  rtlRender(
    <AppProvider value={appValue}>
      <VisibilityScope visible={visible}>
        <LibraryPanel />
      </VisibilityScope>
    </AppProvider>,
  );

const mockListPrompts = vi.hoisted(() => vi.fn());
const mockGetManagedSkills = vi.hoisted(() => vi.fn());
const mockGetTagGroups = vi.hoisted(() => vi.fn());
const mockGetAgentSkills = vi.hoisted(() => vi.fn());
const mockGetAllProjectSkillCounts = vi.hoisted(() => vi.fn());
const mockGetAllProjectTagGroupCounts = vi.hoisted(() => vi.fn());
const mockListAgents = vi.hoisted(() => vi.fn());

vi.mock('@/features/library/api/libraryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/library/api/libraryApi')>();
  return { ...actual, listPrompts: () => mockListPrompts() };
});

vi.mock('@/features/skill/api/skillApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/skill/api/skillApi')>();
  return {
    ...actual,
    getManagedSkills: () => mockGetManagedSkills(),
    getTagGroups: () => mockGetTagGroups(),
    getAgentSkills: () => mockGetAgentSkills(),
    getAllProjectSkillCounts: () => mockGetAllProjectSkillCounts(),
    getAllProjectTagGroupCounts: () => mockGetAllProjectTagGroupCounts(),
  };
});

vi.mock('@/features/agent/api/agentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent/api/agentApi')>();
  return { ...actual, listAgents: () => mockListAgents() };
});

beforeEach(() => {
  resetLibraryState();
  useSkillStore.setState(initialSkillState);
  useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });
  mockListPrompts.mockReset().mockResolvedValue([]);
  mockGetManagedSkills.mockReset().mockResolvedValue([]);
  mockGetTagGroups.mockReset().mockResolvedValue([]);
  mockGetAgentSkills.mockReset().mockResolvedValue([]);
  mockGetAllProjectSkillCounts.mockReset().mockResolvedValue([]);
  mockGetAllProjectTagGroupCounts.mockReset().mockResolvedValue([]);
  mockListAgents.mockReset().mockResolvedValue([]);
});

describe('LibraryPanel — 内部分栏（统一标准）', () => {
  it('挂载后渲染导航岛 + 详情岛 + 可拖拽分隔条', async () => {
    render(<LibraryPanel />);

    // 导航岛：SkillsPanel（Skill views 导航）与详情岛同时挂载
    expect(await screen.findByLabelText('Skill views')).toBeInTheDocument();
    // 分隔条：react-resizable-panels Separator（role=separator）即拖拽手柄
    expect(await screen.findByRole('separator')).toBeInTheDocument();
  });
  it('挂载 Library 子树不改写全局主题/根级 CSS 变量', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    expectNoGlobalSideEffectsOnMount(() => {
      render(<LibraryPanel />);
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    document.documentElement.removeAttribute('data-theme');
  });

  it('隐藏态（visible=false）不拉取 prompts：常驻挂载不花启动期 IPC', async () => {
    renderInScope(false);
    // 子树确实挂载了（导航岛在），但拉取被可见性门控
    await screen.findByLabelText('Skill views');
    expect(mockListPrompts).not.toHaveBeenCalled();
  });

  it('变为可见时拉取一次（首进 / 再次激活的后台刷新由可见性驱动）', async () => {
    const { rerender } = renderInScope(false);
    await screen.findByLabelText('Skill views');
    expect(mockListPrompts).not.toHaveBeenCalled();

    rerender(
      <AppProvider value={appValue}>
        <VisibilityScope visible>
          <LibraryPanel />
        </VisibilityScope>
      </AppProvider>,
    );
    await waitFor(() => expect(mockListPrompts).toHaveBeenCalled());
  });

  it('导航列与详情列挂载稳定的面板 id（尺寸持久化与布局锚点）', async () => {
    render(<LibraryPanel />);
    await screen.findByLabelText('Skill views');

    // v4 用 flex 因子而非内联百分比表达尺寸（jsdom 无布局不可断言宽度本身）；
    // 此处锁定面板身份：id 拼写错误会直接破坏布局与持久化。
    expect(await screen.findByTestId('library-nav')).toBeInTheDocument();
    expect(await screen.findByTestId('library-detail')).toBeInTheDocument();
  });
});
