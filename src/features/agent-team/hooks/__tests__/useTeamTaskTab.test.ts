import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamTaskTab } from '../useTeamTaskTab';

/**
 * 「任务详情」中央 tab 的去重判据（与 `useTeamBoardTab` 同一族，但键不同）。
 *
 * 任务 id **只在队内唯一**（每个队的板都从 `t1` 开始），所以去重必须按
 * `(teamId, taskId)` 两列 —— 只按 taskId 会让 `tm_1/t1` 与 `tm_2/t1` 抢同一个 tab。
 * 本文件钉住这条（它与看板 hook 的不对称正是漏测区）。
 */
const PROJECT = 'p1' as ProjectId;

function taskTabs(): { id: string; teamId?: string; taskId?: string }[] {
  const state = useEditorStore.getState();
  const key = Object.keys(state.tabs).find((k) => k.includes('p1'));
  const space = key ? state.tabs[key] : { tabs: [] };
  return space.tabs
    .filter((t) => t.data.kind === 'team-task')
    .map((t) => ({
      id: t.id,
      teamId: t.data.kind === 'team-task' ? t.data.teamId : undefined,
      taskId: t.data.kind === 'team-task' ? t.data.taskId : undefined,
    }));
}

describe('useTeamTaskTab', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setActiveWorkspace(PROJECT, '/repo', 'main');
    const state = useEditorStore.getState();
    for (const key of Object.keys(state.tabs)) {
      for (const tab of state.tabs[key].tabs) state.closeTab(key, tab.id);
    }
  });

  it('打开 → 落一个 team-task tab 并激活', () => {
    const { result } = renderHook(() => useTeamTaskTab());
    act(() => {
      result.current.openTaskTab({
        teamId: 'tm_1',
        taskId: 't1',
        title: '写解析器',
        projectId: PROJECT,
      });
    });

    const tabs = taskTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ teamId: 'tm_1', taskId: 't1' });
  });

  it('同一队同一任务重复打开：不新开 tab（去重按 (teamId, taskId)）', () => {
    const { result } = renderHook(() => useTeamTaskTab());
    act(() => {
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't1', title: 'A', projectId: PROJECT });
    });
    act(() => {
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't1', title: 'A', projectId: PROJECT });
    });

    expect(taskTabs()).toHaveLength(1);
  });

  it('**不同队的同一个 taskId 是两个 tab**（任务 id 只在队内唯一）', () => {
    const { result } = renderHook(() => useTeamTaskTab());
    act(() => {
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't1', title: 'A', projectId: PROJECT });
      result.current.openTaskTab({ teamId: 'tm_2', taskId: 't1', title: 'B', projectId: PROJECT });
    });

    const tabs = taskTabs();
    expect(tabs).toHaveLength(2);
    expect(new Set(tabs.map((t) => t.teamId))).toEqual(new Set(['tm_1', 'tm_2']));
  });

  it('同队不同任务 → 两个 tab', () => {
    const { result } = renderHook(() => useTeamTaskTab());
    act(() => {
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't1', title: 'A', projectId: PROJECT });
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't2', title: 'B', projectId: PROJECT });
    });

    expect(taskTabs()).toHaveLength(2);
  });

  it('tab 落在传入项目的空间里（不制造伪身份）', () => {
    const { result } = renderHook(() => useTeamTaskTab());
    act(() => {
      result.current.openTaskTab({ teamId: 'tm_1', taskId: 't1', title: 'A', projectId: PROJECT });
    });

    // 只有一个 tab 空间，且它属于 p1（没有 '' 空项目槽位）
    const spaces = Object.keys(useEditorStore.getState().tabs);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toContain('p1');
  });
});
