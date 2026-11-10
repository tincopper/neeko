// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamBoardTab } from '../useTeamBoardTab';

/**
 * 「看板 / 分配图」中央 tab 的开/去重/激活判据。
 *
 * 一支队伍只允许一个看板 tab：重复打开 = 激活既有的并把 view 合并进 tab data ——
 * 否则「从看板切到分配图再点一次打开」会开出第二个 tab，两个 tab 抢同一份快照。
 */
const PROJECT = 'p1' as ProjectId;

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

  it('同一支队伍重复打开：不新开 tab，view 合并进既有 tab', () => {
    const { result } = renderHook(() => useTeamBoardTab());
    act(() => {
      result.current.openBoardTab({
        teamId: 'tm_1',
        teamName: 'refactor',
        projectId: PROJECT,
        view: 'board',
      });
    });
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
    expect(tabs[0].view).toBe('flow');
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
