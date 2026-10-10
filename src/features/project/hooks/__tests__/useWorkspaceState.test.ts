import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceState } from '@/features/project/hooks/useWorkspaceState';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { FileChange, GitStatusSnapshot } from '@/shared/types';
import { WorkspaceSession, type WorkspaceKey } from '@/shared/utils/workspaceRef';

const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';
const WT_A = '/projects/wt-a';
const WT_B = '/projects/wt-b';

/** 某Workspace的 status 夹具（字段与后端 GitStatusSnapshot 同形）。 */
function statusOf(
  projectId: string,
  worktreePath: string | null,
  branch: string,
  entries: FileChange[] = [],
): GitStatusSnapshot {
  return {
    workspace_key: WorkspaceSession.of(projectId, worktreePath ?? null).key,
    version: 1,
    project_id: projectId,
    worktree_path: worktreePath,
    branch,
    entries,
    truncated: false,
  };
}

function seedStatus(projectId: string, worktreePath: string | null, branch: string): void {
  useProjectStore.getState().applyStatus(statusOf(projectId, worktreePath, branch));
}

function seededKeys(): string[] {
  return Object.keys(useProjectStore.getState().statuses);
}

/** 单元切换会移动编辑器激活 tab 指针 —— 给某单元建一个带激活 tab 的 tab 空间。 */
function seedTabSpace(projectId: string, worktreePath: string | null, activeTabId: string): void {
  const key = WorkspaceSession.of(projectId, worktreePath ?? null).key;
  useEditorStore.setState((state) => ({
    tabs: { ...state.tabs, [key]: { tabs: [], activeTabId } },
  }));
}

describe('useWorkspaceState', () => {
  beforeEach(() => {
    // 单一表示：workspaceStore 只有 byProject 一份状态；镜像字段已删除，
    // 复位也必须只复位它（写不存在的键会让 store 里残留别的用例的单元）。
    useWorkspaceStore.setState({ byProject: {} });
    useProjectStore.setState({ statuses: {}, activeProjectId: PROJECT, projects: [] });
    useEditorStore.setState({ tabs: {}, activeTabId: null });
  });

  it('初始状态为空（主仓单元、无分支、无已打开清单）', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    expect(result.current.activeCheckoutPath).toBeNull();
    expect(result.current.activeCheckoutBranch).toBe('');
    expect(result.current.openedCheckouts).toEqual([]);
  });

  it('mutator 按传入 projectId 写状态，与渲染时绑定的项目无关（跨项目串写回归契约）', () => {
    // 渲染时绑定 OTHER_PROJECT（模拟「切换前」的闭包形态）：mutator 显式收 projectId，
    // 写入必须落在传入的项目上，绝不污染渲染时绑定的那个。
    const { result } = renderHook(() => useWorkspaceState(OTHER_PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
      result.current.markWorkspaceOpened(PROJECT, WT_A, 'feature-a');
      result.current.setActiveWorkspaceBranch(PROJECT, 'develop');
      result.current.clearActiveWorkspace(PROJECT);
    });

    expect(useWorkspaceStore.getState().byProject[OTHER_PROJECT]).toBeUndefined();
    // 最后一步 clear 把 PROJECT 的激活态清回主仓；opened 清单保留
    expect(useWorkspaceStore.getState().byProject[PROJECT]).toMatchObject({
      activePath: null,
      activeBranch: '',
      opened: [{ path: WT_A, branch: 'feature-a' }],
    });
    // 读取面仍跟随渲染时绑定的项目
    expect(result.current.activeCheckoutPath).toBeNull();
    expect(result.current.openedCheckouts).toEqual([]);
  });

  it('activateWorkspace 同时更新路径和分支', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });

    expect(result.current.activeCheckoutPath).toBe(WT_A);
    expect(result.current.activeCheckoutBranch).toBe('feature-a');
    expect(useWorkspaceStore.getState().byProject[PROJECT]).toMatchObject({
      activePath: WT_A,
      activeBranch: 'feature-a',
    });
  });

  it('activateWorkspace 不带分支时只更新路径（分支保持原值）', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A);
    });
    expect(result.current.activeCheckoutPath).toBe(WT_A);
    expect(result.current.activeCheckoutBranch).toBe('');

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_B, 'feature-b');
    });
    // 显式传分支 → 覆盖
    expect(result.current.activeCheckoutBranch).toBe('feature-b');

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A);
    });
    // 不传分支 → 保留上一个已知值（激活路径与分支分别有各自的生产者）
    expect(result.current.activeCheckoutPath).toBe(WT_A);
    expect(result.current.activeCheckoutBranch).toBe('feature-b');
  });

  it('setActiveWorkspaceBranch 只更新分支、不切换单元', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    act(() => {
      result.current.setActiveWorkspaceBranch(PROJECT, 'renamed-branch');
    });

    expect(result.current.activeCheckoutBranch).toBe('renamed-branch');
    expect(result.current.activeCheckoutPath).toBe(WT_A);
  });

  it('markWorkspaceOpened 追加已打开清单且不改激活态、同路径去重', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.markWorkspaceOpened(PROJECT, WT_A, 'main');
      result.current.markWorkspaceOpened(PROJECT, WT_B, 'feature');
      result.current.markWorkspaceOpened(PROJECT, WT_A, 'main-renamed');
    });

    expect(result.current.openedCheckouts).toEqual([
      { path: WT_A, branch: 'main' },
      { path: WT_B, branch: 'feature' },
    ]);
    // 「打开过」不等于「正在看」
    expect(result.current.activeCheckoutPath).toBeNull();
  });

  it('切到另一单元时作废**上一个单元**的 status 槽（A 的数据不得在查看 B 时被渲染）', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');
    expect(seededKeys()).toContain(WorkspaceSession.of(PROJECT, WT_A ?? null).key);

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_B, 'feature-b');
    });

    // 旧单元此后没有生产者 → 槽位必须为空（未挂载 = 未知），渲染侧走 unknown 分支
    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of(PROJECT, WT_A ?? null).key],
    ).toBeUndefined();
    expect(seededKeys()).not.toContain(WorkspaceSession.of(PROJECT, WT_A ?? null).key);
  });

  it('从主仓切到 worktree 时作废主仓槽位；反向亦然', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    seedStatus(PROJECT, null, 'main');
    seedTabSpace(PROJECT, null, 'main-tab');

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of(PROJECT, null).key],
    ).toBeUndefined();

    seedStatus(PROJECT, WT_A, 'feature-a');
    act(() => {
      result.current.activateWorkspace(PROJECT, null);
    });
    expect(result.current.activeCheckoutPath).toBeNull();
    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of(PROJECT, WT_A ?? null).key],
    ).toBeUndefined();
  });

  it('重复激活同一单元不作废自己的槽位（否则每次点列表都会闪一下空态）', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });

    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of(PROJECT, WT_A ?? null).key],
    ).toBeDefined();
  });

  it('clearActiveWorkspace 回到主仓并作废当前单元槽位', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');

    act(() => {
      result.current.clearActiveWorkspace(PROJECT);
    });

    expect(result.current.activeCheckoutPath).toBeNull();
    expect(result.current.activeCheckoutBranch).toBe('');
    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of(PROJECT, WT_A ?? null).key],
    ).toBeUndefined();
  });

  it('activateWorkspace 把编辑器激活 tab 指针移到目标单元的 tab 空间', () => {
    seedTabSpace(PROJECT, null, 'main-tab');
    seedTabSpace(PROJECT, WT_A, 'wt-a-tab');
    useEditorStore.setState({ activeTabId: 'main-tab' });

    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    expect(useEditorStore.getState().activeTabId).toBe('wt-a-tab');

    act(() => {
      result.current.activateWorkspace(PROJECT, null);
    });
    expect(useEditorStore.getState().activeTabId).toBe('main-tab');
  });

  it('目标单元没有 tab 空间时激活位置空（不残留上一单元的 tab id）', () => {
    seedTabSpace(PROJECT, null, 'main-tab');
    useEditorStore.setState({ activeTabId: 'main-tab' });

    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });

    expect(useEditorStore.getState().activeTabId).toBeNull();
  });

  it('不同项目间的激活态相互隔离（无全局镜像）', () => {
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useWorkspaceState(projectId),
      { initialProps: { projectId: PROJECT as string | null } },
    );

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
      result.current.markWorkspaceOpened(PROJECT, WT_A, 'feature-a');
    });

    rerender({ projectId: OTHER_PROJECT });
    expect(result.current.activeCheckoutPath).toBeNull();
    expect(result.current.activeCheckoutBranch).toBe('');
    expect(result.current.openedCheckouts).toEqual([]);

    rerender({ projectId: PROJECT });
    expect(result.current.activeCheckoutPath).toBe(WT_A);
    expect(result.current.activeCheckoutBranch).toBe('feature-a');
    expect(result.current.openedCheckouts).toEqual([{ path: WT_A, branch: 'feature-a' }]);
  });

  it('为 X 项目切换单元不会作废 Y 项目的槽位', () => {
    seedStatus(PROJECT, WT_A, 'feature-a');
    seedStatus(OTHER_PROJECT, WT_B, 'feature-b');
    seedStatus(OTHER_PROJECT, null, 'main');

    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    act(() => {
      result.current.activateWorkspace(PROJECT, WT_B, 'feature-b');
    });

    const liveKeys = seededKeys();
    expect(liveKeys).toContain(WorkspaceSession.of(OTHER_PROJECT, WT_B ?? null).key);
    expect(liveKeys).toContain(WorkspaceSession.of(OTHER_PROJECT, null).key);
    // 只有 PROJECT 自己的历史单元被作废
    expect(liveKeys).not.toContain(WorkspaceSession.of(PROJECT, null).key);
  });

  it('markWorkspaceOpened / clearActiveWorkspace 只作用于目标项目', () => {
    const { result } = renderHook(() => useWorkspaceState(PROJECT));

    act(() => {
      result.current.markWorkspaceOpened(PROJECT, WT_A, 'feature-a');
      result.current.activateWorkspace(PROJECT, WT_A, 'feature-a');
    });
    useWorkspaceStore.getState().setActiveWorkspace(OTHER_PROJECT, WT_B, 'feature-b');
    seedStatus(OTHER_PROJECT, WT_B, 'feature-b');

    act(() => {
      result.current.clearActiveWorkspace(PROJECT);
    });

    expect(useWorkspaceStore.getState().byProject[OTHER_PROJECT]).toMatchObject({
      activePath: WT_B,
      activeBranch: 'feature-b',
    });
    expect(
      useProjectStore.getState().statuses[
        WorkspaceSession.of(OTHER_PROJECT, WT_B ?? null).key as WorkspaceKey
      ],
    ).toBeDefined();
  });
});
