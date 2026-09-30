import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorktreeState } from '@/features/project/hooks/useWorktreeState';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange, GitStatusSnapshot } from '@/shared/types';
import { repoKeyOf, type RepoKey } from '@/shared/utils/repoRef';
import { resolveTabKey } from '@/shared/utils/tabKey';

const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';
const WT_A = '/projects/wt-a';
const WT_B = '/projects/wt-b';

/** 某仓库单元的 status 夹具（字段与后端 GitStatusSnapshot 同形）。 */
function statusOf(
  projectId: string,
  worktreePath: string | null,
  branch: string,
  entries: FileChange[] = [],
): GitStatusSnapshot {
  return {
    repo_key: repoKeyOf(projectId, worktreePath),
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
  const key = resolveTabKey(projectId, worktreePath);
  useEditorStore.setState((state) => ({
    tabs: { ...state.tabs, [key]: { tabs: [], activeTabId } },
  }));
}

describe('useWorktreeState', () => {
  beforeEach(() => {
    // 单一表示：worktreeStore 只有 byProject 一份状态；镜像字段已删除，
    // 复位也必须只复位它（写不存在的键会让 store 里残留别的用例的单元）。
    useWorktreeStore.setState({ byProject: {} });
    useProjectStore.setState({ statuses: {}, activeProjectId: PROJECT, projects: [] });
    useEditorStore.setState({ tabs: {}, activeTabId: null });
  });

  it('初始状态为空（主仓单元、无分支、无已打开清单）', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');
    expect(result.current.openedWorktrees).toEqual([]);
  });

  it('mutator 按传入 projectId 写状态，与渲染时绑定的项目无关（跨项目串写回归契约）', () => {
    // 渲染时绑定 OTHER_PROJECT（模拟「切换前」的闭包形态）：mutator 显式收 projectId，
    // 写入必须落在传入的项目上，绝不污染渲染时绑定的那个。
    const { result } = renderHook(() => useWorktreeState(OTHER_PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
      result.current.markWorktreeOpened(PROJECT, WT_A, 'feature-a');
      result.current.setActiveWorktreeBranch(PROJECT, 'develop');
      result.current.clearActiveWorktree(PROJECT);
    });

    expect(useWorktreeStore.getState().byProject[OTHER_PROJECT]).toBeUndefined();
    // 最后一步 clear 把 PROJECT 的激活态清回主仓；opened 清单保留
    expect(useWorktreeStore.getState().byProject[PROJECT]).toMatchObject({
      activePath: null,
      activeBranch: '',
      opened: [{ path: WT_A, branch: 'feature-a' }],
    });
    // 读取面仍跟随渲染时绑定的项目
    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.openedWorktrees).toEqual([]);
  });

  it('activateWorktree 同时更新路径和分支', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });

    expect(result.current.activeWorktreePath).toBe(WT_A);
    expect(result.current.activeWorktreeBranch).toBe('feature-a');
    expect(useWorktreeStore.getState().byProject[PROJECT]).toMatchObject({
      activePath: WT_A,
      activeBranch: 'feature-a',
    });
  });

  it('activateWorktree 不带分支时只更新路径（分支保持原值）', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A);
    });
    expect(result.current.activeWorktreePath).toBe(WT_A);
    expect(result.current.activeWorktreeBranch).toBe('');

    act(() => {
      result.current.activateWorktree(PROJECT, WT_B, 'feature-b');
    });
    // 显式传分支 → 覆盖
    expect(result.current.activeWorktreeBranch).toBe('feature-b');

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A);
    });
    // 不传分支 → 保留上一个已知值（激活路径与分支分别有各自的生产者）
    expect(result.current.activeWorktreePath).toBe(WT_A);
    expect(result.current.activeWorktreeBranch).toBe('feature-b');
  });

  it('setActiveWorktreeBranch 只更新分支、不切换单元', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    act(() => {
      result.current.setActiveWorktreeBranch(PROJECT, 'renamed-branch');
    });

    expect(result.current.activeWorktreeBranch).toBe('renamed-branch');
    expect(result.current.activeWorktreePath).toBe(WT_A);
  });

  it('markWorktreeOpened 追加已打开清单且不改激活态、同路径去重', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.markWorktreeOpened(PROJECT, WT_A, 'main');
      result.current.markWorktreeOpened(PROJECT, WT_B, 'feature');
      result.current.markWorktreeOpened(PROJECT, WT_A, 'main-renamed');
    });

    expect(result.current.openedWorktrees).toEqual([
      { path: WT_A, branch: 'main' },
      { path: WT_B, branch: 'feature' },
    ]);
    // 「打开过」不等于「正在看」
    expect(result.current.activeWorktreePath).toBeNull();
  });

  it('切到另一单元时作废**上一个单元**的 status 槽（A 的数据不得在查看 B 时被渲染）', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');
    expect(seededKeys()).toContain(repoKeyOf(PROJECT, WT_A));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_B, 'feature-b');
    });

    // 旧单元此后没有生产者 → 槽位必须为空（未挂载 = 未知），渲染侧走 unknown 分支
    expect(useProjectStore.getState().statuses[repoKeyOf(PROJECT, WT_A)]).toBeUndefined();
    expect(seededKeys()).not.toContain(repoKeyOf(PROJECT, WT_A));
  });

  it('从主仓切到 worktree 时作废主仓槽位；反向亦然', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    seedStatus(PROJECT, null, 'main');
    seedTabSpace(PROJECT, null, 'main-tab');

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    expect(useProjectStore.getState().statuses[repoKeyOf(PROJECT, null)]).toBeUndefined();

    seedStatus(PROJECT, WT_A, 'feature-a');
    act(() => {
      result.current.activateWorktree(PROJECT, null);
    });
    expect(result.current.activeWorktreePath).toBeNull();
    expect(useProjectStore.getState().statuses[repoKeyOf(PROJECT, WT_A)]).toBeUndefined();
  });

  it('重复激活同一单元不作废自己的槽位（否则每次点列表都会闪一下空态）', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });

    expect(useProjectStore.getState().statuses[repoKeyOf(PROJECT, WT_A)]).toBeDefined();
  });

  it('clearActiveWorktree 回到主仓并作废当前单元槽位', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    seedStatus(PROJECT, WT_A, 'feature-a');

    act(() => {
      result.current.clearActiveWorktree(PROJECT);
    });

    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');
    expect(useProjectStore.getState().statuses[repoKeyOf(PROJECT, WT_A)]).toBeUndefined();
  });

  it('activateWorktree 把编辑器激活 tab 指针移到目标单元的 tab 空间', () => {
    seedTabSpace(PROJECT, null, 'main-tab');
    seedTabSpace(PROJECT, WT_A, 'wt-a-tab');
    useEditorStore.setState({ activeTabId: 'main-tab' });

    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    expect(useEditorStore.getState().activeTabId).toBe('wt-a-tab');

    act(() => {
      result.current.activateWorktree(PROJECT, null);
    });
    expect(useEditorStore.getState().activeTabId).toBe('main-tab');
  });

  it('目标单元没有 tab 空间时激活位置空（不残留上一单元的 tab id）', () => {
    seedTabSpace(PROJECT, null, 'main-tab');
    useEditorStore.setState({ activeTabId: 'main-tab' });

    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });

    expect(useEditorStore.getState().activeTabId).toBeNull();
  });

  it('不同项目间的激活态相互隔离（无全局镜像）', () => {
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useWorktreeState(projectId),
      { initialProps: { projectId: PROJECT as string | null } },
    );

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
      result.current.markWorktreeOpened(PROJECT, WT_A, 'feature-a');
    });

    rerender({ projectId: OTHER_PROJECT });
    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');
    expect(result.current.openedWorktrees).toEqual([]);

    rerender({ projectId: PROJECT });
    expect(result.current.activeWorktreePath).toBe(WT_A);
    expect(result.current.activeWorktreeBranch).toBe('feature-a');
    expect(result.current.openedWorktrees).toEqual([{ path: WT_A, branch: 'feature-a' }]);
  });

  it('为 X 项目切换单元不会作废 Y 项目的槽位', () => {
    seedStatus(PROJECT, WT_A, 'feature-a');
    seedStatus(OTHER_PROJECT, WT_B, 'feature-b');
    seedStatus(OTHER_PROJECT, null, 'main');

    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    act(() => {
      result.current.activateWorktree(PROJECT, WT_B, 'feature-b');
    });

    const liveKeys = seededKeys();
    expect(liveKeys).toContain(repoKeyOf(OTHER_PROJECT, WT_B));
    expect(liveKeys).toContain(repoKeyOf(OTHER_PROJECT, null));
    // 只有 PROJECT 自己的历史单元被作废
    expect(liveKeys).not.toContain(repoKeyOf(PROJECT, null));
  });

  it('markWorktreeOpened / clearActiveWorktree 只作用于目标项目', () => {
    const { result } = renderHook(() => useWorktreeState(PROJECT));

    act(() => {
      result.current.markWorktreeOpened(PROJECT, WT_A, 'feature-a');
      result.current.activateWorktree(PROJECT, WT_A, 'feature-a');
    });
    useWorktreeStore.getState().setActiveWorktree(OTHER_PROJECT, WT_B, 'feature-b');
    seedStatus(OTHER_PROJECT, WT_B, 'feature-b');

    act(() => {
      result.current.clearActiveWorktree(PROJECT);
    });

    expect(useWorktreeStore.getState().byProject[OTHER_PROJECT]).toMatchObject({
      activePath: WT_B,
      activeBranch: 'feature-b',
    });
    expect(
      useProjectStore.getState().statuses[repoKeyOf(OTHER_PROJECT, WT_B) as RepoKey],
    ).toBeDefined();
  });
});
