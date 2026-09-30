/**
 * `worktreeStore` 的唯一派生点 + 激活态 mutator。
 *
 * 「当前视图所在仓库单元」的 key 以前在 6 处各自手写
 * （`repoKeyOf(projectId, byProject[projectId]?.activePath ?? null)`）：事件回调、hook、组件、
 * store 内部各一份。任何一处漏改 / 加特例都会让「当前单元」出现第二种表示 —— 那正是本任务
 * 要根治的症状形态。本文件钉住**唯一**派生点的语义，护栏
 * （`check_repo_unit_identity`）禁止绕过它直读 `.byProject[...].activePath`。
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeRepoKeyOf,
  selectActiveRepoKey,
  selectActiveWorktreePath,
  useActiveRepoKey,
  useWorktreeStore,
} from '@/shared/store/worktreeStore';
import { repoKeyOf } from '@/shared/utils/repoRef';

const WT_A = '/wt/a';
const MAIN_KEY = repoKeyOf('p1', null);
const WT_KEY = repoKeyOf('p1', WT_A);

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: null, activeProject: null, projects: [] });
  useWorktreeStore.setState({ byProject: {} });
});

describe('selectActiveRepoKey —— 当前视图单元的唯一派生点', () => {
  it('有激活 worktree 时派生该单元的 key，无激活时派生主仓 key', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');

    expect(selectActiveRepoKey(useWorktreeStore.getState(), 'p1')).toBe(WT_KEY);

    useWorktreeStore.getState().clearActiveWorktree('p1');
    expect(selectActiveRepoKey(useWorktreeStore.getState(), 'p1')).toBe(MAIN_KEY);
  });

  it('store 里没有该项目的条目时按主仓派生；未给 projectId 时返回 null', () => {
    // 「无激活态条目」= 该项目还没选过 worktree（主仓）—— 不是「未知项目」，故仍派生主仓 key
    expect(selectActiveRepoKey(useWorktreeStore.getState(), 'missing')).toBe(
      repoKeyOf('missing', null),
    );
    expect(selectActiveRepoKey(useWorktreeStore.getState(), null)).toBeNull();
    expect(selectActiveRepoKey(useWorktreeStore.getState(), '')).toBeNull();
  });

  it('与 selectActiveWorktreePath 同源（同一份表示的两个投影）', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    const state = useWorktreeStore.getState();

    expect(selectActiveRepoKey(state, 'p1')).toBe(
      repoKeyOf('p1', selectActiveWorktreePath(state, 'p1')),
    );
  });
});

describe('useActiveRepoKey —— 渲染期形态（与 selectActiveRepoKey 同源）', () => {
  it('跟随激活态变化重算，且无 projectId 时为 null（不产出 NUL 空键）', () => {
    const { result, rerender } = renderHook(({ pid }) => useActiveRepoKey(pid), {
      initialProps: { pid: 'p1' as string | null },
    });
    // 无激活条目 ⇒ 主仓单元（不是 null —— 「该项目还没选过 worktree」不等于「未知项目」）
    expect(result.current).toBe(MAIN_KEY);

    act(() => {
      useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    });
    expect(result.current).toBe(WT_KEY);

    rerender({ pid: null });
    expect(result.current).toBeNull();
  });
});

describe('activeRepoKeyOf —— 命令式形态（事件回调 / 命令式流程）', () => {
  it('显式 projectId：取该项目的激活单元', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    useWorktreeStore.getState().setActiveWorktree('p2', null);

    expect(activeRepoKeyOf('p1')).toBe(WT_KEY);
    expect(activeRepoKeyOf('p2')).toBe(repoKeyOf('p2', null));
  });

  it('缺省取**当前激活项目**的单元（无激活项目时为 null）', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');

    expect(activeRepoKeyOf()).toBeNull();

    useProjectStore.setState({ activeProjectId: 'p1' });
    expect(activeRepoKeyOf()).toBe(WT_KEY);
  });

  it('不同项目的激活态互不串用（无全局镜像）', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    useProjectStore.setState({ activeProjectId: 'p2' });

    expect(activeRepoKeyOf()).toBe(repoKeyOf('p2', null));
    expect(activeRepoKeyOf('p1')).toBe(WT_KEY);
  });
});

describe('激活态 mutator 的最小契约', () => {
  it('clearActiveWorktree 只清目标项目，回落主仓单元', () => {
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    useWorktreeStore.getState().setActiveWorktree('p2', WT_A, 'feature-a');

    useWorktreeStore.getState().clearActiveWorktree('p1');

    expect(activeRepoKeyOf('p1')).toBe(MAIN_KEY);
    expect(activeRepoKeyOf('p2')).toBe(repoKeyOf('p2', WT_A));
  });

  it('clearActiveWorktree 同步作废该单元的 status 槽位（单点收口，调用方无需各自补刀）', () => {
    // 回归契约：切项目 / 删 worktree / 项目移除的调用点曾全部漏掉 invalidateStatus，
    // 被清掉的单元槽位残留旧快照继续被渲染（I1-b：未知 ≠ 旧数据）。
    useProjectStore.setState({ statuses: {} } as never);
    useWorktreeStore.getState().setActiveWorktree('p1', WT_A, 'feature-a');
    useProjectStore.getState().applyStatus({
      repo_key: String(WT_KEY),
      project_id: 'p1',
      worktree_path: WT_A,
      version: 1,
      branch: 'feature-a',
      entries: [],
      truncated: false,
    } as never);
    expect(useProjectStore.getState().statuses[String(WT_KEY)]).toBeDefined();

    useWorktreeStore.getState().clearActiveWorktree('p1');

    expect(useProjectStore.getState().statuses[String(WT_KEY)]).toBeUndefined();
    expect(activeRepoKeyOf('p1')).toBe(MAIN_KEY);
  });

  it('markWorktreeOpened 同路径去重、不改激活态', () => {
    const store = useWorktreeStore.getState();

    store.markWorktreeOpened('p1', WT_A, 'feature-a');
    store.markWorktreeOpened('p1', WT_A, 'feature-a-renamed');

    expect(useWorktreeStore.getState().byProject['p1']?.opened).toEqual([
      { path: WT_A, branch: 'feature-a' },
    ]);
    expect(activeRepoKeyOf('p1')).toBe(MAIN_KEY);
  });
});
