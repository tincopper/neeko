// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamBoardTab } from '../useTeamBoardTab';

/**
 * 「看板 / 分配图」中央 tab 的开 / 去重 / 激活判据。
 *
 * 一支队伍只允许一个看板 tab；**重复打开只激活**（R4）—— 「打开」是「带我去那儿」，不是
 * 「重置我上次的选择」。tab 里的 `view` 是导航态，写完就归那个 tab 自己（用户在 tab 内的
 * 切换经 `PaneContent` 注入的 `onViewChange` 落 `updateTab`）。
 */
const PROJECT = 'p1' as ProjectId;

const originalUpdateTab = useEditorStore.getState().updateTab;
const originalActivateTab = useEditorStore.getState().activateTab;
const updateTab = vi.fn((...args: Parameters<typeof originalUpdateTab>) =>
  originalUpdateTab(...args),
);
const activateTab = vi.fn((...args: Parameters<typeof originalActivateTab>) =>
  originalActivateTab(...args),
);

function boardTabs(): { id: string; view?: string }[] {
  const state = useEditorStore.getState();
  const session = useWorkspaceStore.getState().setActiveWorkspace(PROJECT, '/repo', 'main');
  const key = Object.keys(useEditorStore.getState().tabs).find((k) => k.includes('p1'));
  void session;
  const space = key ? state.tabs[key] : { tabs: [] };
  return space.tabs
    .filter((t) => t.data.kind === 'team-board')
    .map((t) => ({
      id: t.id,
      view: t.data.kind === 'team-board' ? t.data.view : undefined,
    }));
}

describe('useTeamBoardTab', () => {
  beforeEach(() => {
    // 写入点计数：AC4 要断言「重复打开不改视图」就是断言这里零调用。
    useEditorStore.setState({ updateTab, activateTab });
    updateTab.mockClear();
    activateTab.mockClear();
    useWorkspaceStore.getState().setActiveWorkspace(PROJECT, '/repo', 'main');
    // 清空 tab 空间
    const state = useEditorStore.getState();
    for (const key of Object.keys(state.tabs)) {
      for (const tab of state.tabs[key].tabs) state.closeTab(key, tab.id);
    }
  });

  it('打开 → 落一个 team-board tab 并激活', () => {
    const { result } = renderHook(() => useTeamBoardTab());
    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'refactor',
        projectId: PROJECT,
        view: 'board',
      });
    });
    const tabs = boardTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ view: 'board' });
  });

  it('新建 tab 时 view 取调用方传入值（首次打开因此永远是看板列表）', () => {
    const { result } = renderHook(() => useTeamBoardTab());
    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'refactor',
        projectId: PROJECT,
        view: 'flow',
      });
    });

    expect(boardTabs()[0]).toMatchObject({ view: 'flow' });
  });

  /**
   * R4 / AC4：已存在的 tab **只激活**，不改它的视图。
   *
   * 旧行为把「打开」当成「推送一个视图过去」（`updateTab` 合并 view）—— 于是用户切走
   * 再点一次打开，上次的选择被抹掉。判据是 `updateTab` **零调用**：任何写入都等于重置。
   */
  it('同一支队伍重复打开：只激活，不改既有 tab 的视图（updateTab 零调用）', () => {
    const { result } = renderHook(() => useTeamBoardTab());
    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'refactor',
        projectId: PROJECT,
        view: 'board',
      });
    });
    updateTab.mockClear();
    activateTab.mockClear();

    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'refactor',
        projectId: PROJECT,
        view: 'flow',
      });
    });

    const tabs = boardTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].view).toBe('board');
    expect(updateTab).not.toHaveBeenCalled();
    expect(activateTab).toHaveBeenCalledTimes(1);
  });

  it('另一支队伍是另一个 tab', () => {
    const { result } = renderHook(() => useTeamBoardTab());
    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'a',
        projectId: PROJECT,
        view: 'board',
      });
      result.current.openBoardTab({
        teamId: 'tm_2',
        teamName: 'b',
        projectId: PROJECT,
        view: 'board',
      });
    });
    expect(boardTabs()).toHaveLength(2);
  });
});
