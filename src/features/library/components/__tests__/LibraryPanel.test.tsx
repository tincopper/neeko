import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState } from '@/features/library/store/libraryStore';
import { initialSkillState, useSkillStore } from '@/features/skill/store';
import { useProjectStore } from '@/shared/store/projectStore';

import LibraryPanel from '../LibraryPanel';

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
  it('导航列与详情列挂载稳定的面板 id（尺寸持久化与布局锚点）', async () => {
    render(<LibraryPanel />);
    await screen.findByLabelText('Skill views');

    // v4 用 flex 因子而非内联百分比表达尺寸（jsdom 无布局不可断言宽度本身）；
    // 此处锁定面板身份：id 拼写错误会直接破坏布局与持久化。
    expect(await screen.findByTestId('library-nav')).toBeInTheDocument();
    expect(await screen.findByTestId('library-detail')).toBeInTheDocument();
  });
});
