/**
 * `workspaceStore` 的唯一派生点 + 激活态 mutator。
 *
 * 「当前视图所在Workspace」的 key 以前在 6 处各自手写
 * （`WorkspaceSession.of(projectId, (byProject[projectId]?.activePath ?? null) ?? null).key`）：事件回调、hook、组件、
 * store 内部各一份。任何一处漏改 / 加特例都会让「当前单元」出现第二种表示 —— 那正是本任务
 * 要根治的症状形态。本文件钉住**唯一**派生点的语义，护栏
 * （`check_workspace_identity`）禁止绕过它直读 `.byProject[...].activePath`。
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceKeyOf,
  activeWorkspaceSession,
  selectActiveWorkspaceKey,
  selectActiveCheckoutPath,
  useActiveWorkspaceKey,
  useActiveWorkspaceSession,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import { WorkspaceSession, isMainCheckout } from '@/shared/utils/workspaceRef';

const WT_A = '/wt/a';
const MAIN_KEY = WorkspaceSession.of('p1', null).key;
const WT_KEY = WorkspaceSession.of('p1', WT_A ?? null).key;

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: null, activeProject: null, projects: [] });
  useWorkspaceStore.setState({ byProject: {} });
});

describe('selectActiveWorkspaceKey —— 当前视图单元的唯一派生点', () => {
  it('有激活 worktree 时派生该单元的 key，无激活时派生主仓 key', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');

    expect(selectActiveWorkspaceKey(useWorkspaceStore.getState(), 'p1')).toBe(WT_KEY);

    useWorkspaceStore.getState().clearActiveWorkspace('p1');
    expect(selectActiveWorkspaceKey(useWorkspaceStore.getState(), 'p1')).toBe(MAIN_KEY);
  });

  it('store 里没有该项目的条目时按主仓派生；未给 projectId 时返回 null', () => {
    // 「无激活态条目」= 该项目还没选过 worktree（主仓）—— 不是「未知项目」，故仍派生主仓 key
    expect(selectActiveWorkspaceKey(useWorkspaceStore.getState(), 'missing')).toBe(
      WorkspaceSession.of('missing', null).key,
    );
    expect(selectActiveWorkspaceKey(useWorkspaceStore.getState(), null)).toBeNull();
    expect(selectActiveWorkspaceKey(useWorkspaceStore.getState(), '')).toBeNull();
  });

  it('与 selectActiveCheckoutPath 同源（同一份表示的两个投影）', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    const state = useWorkspaceStore.getState();

    expect(selectActiveWorkspaceKey(state, 'p1')).toBe(
      WorkspaceSession.of('p1', selectActiveCheckoutPath(state, 'p1') ?? null).key,
    );
  });
});

describe('useActiveWorkspaceKey —— 渲染期形态（与 selectActiveWorkspaceKey 同源）', () => {
  it('跟随激活态变化重算，且无 projectId 时为 null（不产出 NUL 空键）', () => {
    const { result, rerender } = renderHook(({ pid }) => useActiveWorkspaceKey(pid), {
      initialProps: { pid: 'p1' as string | null },
    });
    // 无激活条目 ⇒ 主仓单元（不是 null —— 「该项目还没选过 worktree」不等于「未知项目」）
    expect(result.current).toBe(MAIN_KEY);

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    });
    expect(result.current).toBe(WT_KEY);

    rerender({ pid: null });
    expect(result.current).toBeNull();
  });
});

describe('activeWorkspaceKeyOf —— 命令式形态（事件回调 / 命令式流程）', () => {
  it('显式 projectId：取该项目的激活单元', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    useWorkspaceStore.getState().setActiveWorkspace('p2', null);

    expect(activeWorkspaceKeyOf('p1')).toBe(WT_KEY);
    expect(activeWorkspaceKeyOf('p2')).toBe(WorkspaceSession.of('p2', null).key);
  });

  it('缺省取**当前激活项目**的单元（无激活项目时为 null）', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');

    expect(activeWorkspaceKeyOf()).toBeNull();

    useProjectStore.setState({ activeProjectId: 'p1' });
    expect(activeWorkspaceKeyOf()).toBe(WT_KEY);
  });

  it('不同项目的激活态互不串用（无全局镜像）', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    useProjectStore.setState({ activeProjectId: 'p2' });

    expect(activeWorkspaceKeyOf()).toBe(WorkspaceSession.of('p2', null).key);
    expect(activeWorkspaceKeyOf('p1')).toBe(WT_KEY);
  });
});

describe('激活态 mutator 的最小契约', () => {
  it('clearActiveWorkspace 只清目标项目，回落主仓单元', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    useWorkspaceStore.getState().setActiveWorkspace('p2', WT_A, 'feature-a');

    useWorkspaceStore.getState().clearActiveWorkspace('p1');

    expect(activeWorkspaceKeyOf('p1')).toBe(MAIN_KEY);
    expect(activeWorkspaceKeyOf('p2')).toBe(WorkspaceSession.of('p2', WT_A ?? null).key);
  });

  it('clearActiveWorkspace 同步作废该单元的 status 槽位（单点收口，调用方无需各自补刀）', () => {
    // 回归契约：切项目 / 删 worktree / 项目移除的调用点曾全部漏掉 invalidateStatus，
    // 被清掉的单元槽位残留旧快照继续被渲染（I1-b：未知 ≠ 旧数据）。
    useProjectStore.setState({ statuses: {} } as never);
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    useProjectStore.getState().applyStatus({
      workspace_key: String(WT_KEY),
      project_id: 'p1',
      worktree_path: WT_A,
      version: 1,
      branch: 'feature-a',
      entries: [],
      truncated: false,
    } as never);
    expect(useProjectStore.getState().statuses[String(WT_KEY)]).toBeDefined();

    useWorkspaceStore.getState().clearActiveWorkspace('p1');

    expect(useProjectStore.getState().statuses[String(WT_KEY)]).toBeUndefined();
    expect(activeWorkspaceKeyOf('p1')).toBe(MAIN_KEY);
  });

  it('markWorkspaceOpened 同路径去重、不改激活态', () => {
    const store = useWorkspaceStore.getState();

    store.markWorkspaceOpened('p1', WT_A, 'feature-a');
    store.markWorkspaceOpened('p1', WT_A, 'feature-a-renamed');

    expect(useWorkspaceStore.getState().byProject['p1']?.opened).toEqual([
      { path: WT_A, branch: 'feature-a' },
    ]);
    expect(activeWorkspaceKeyOf('p1')).toBe(MAIN_KEY);
  });
});

describe('activeWorkspaceSession —— 当前视图单元的地址值构造', () => {
  it('激活 worktree 时给出其身份；回落主仓时 worktreePath = null', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    expect(activeWorkspaceSession('p1')).toEqual({ projectId: 'p1', worktreePath: WT_A });
    expect(isMainCheckout(activeWorkspaceSession('p1'))).toBe(false);

    useWorkspaceStore.getState().clearActiveWorkspace('p1');
    expect(activeWorkspaceSession('p1')).toEqual({ projectId: 'p1', worktreePath: null });
    expect(isMainCheckout(activeWorkspaceSession('p1'))).toBe(true);
  });

  /**
   * 不变量 4 的一致性：session 的判别必须与 codec（workspaceKeyOf / key 判别）对
   * '' / 空白的归一规则**同源** —— 否则同一激活态出现「key 判主仓、session 判
   * worktree」两种结论（审核 Warning 的根因）。
   */
  it("'' / 空白激活态与 codec 归一一致（双判据同值）", () => {
    useWorkspaceStore.setState({
      byProject: {
        p1: { activePath: '  ', opened: [{ path: '  ', branch: '' }] },
      },
    });
    const session = activeWorkspaceSession('p1');
    expect(isMainCheckout(session)).toBe(isMainCheckout(activeWorkspaceKeyOf('p1') ?? ''));
  });

  it('响应式形态 useActiveWorkspaceSession 与命令式同源（含空串归一、无项目 → null）', () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WT_A, 'feature-a');
    const { result, rerender } = renderHook(({ pid }) => useActiveWorkspaceSession(pid), {
      initialProps: { pid: 'p1' as string | null },
    });
    expect(result.current).toEqual({ projectId: 'p1', worktreePath: WT_A });
    expect(isMainCheckout(result.current ?? '')).toBe(false);

    // '' / 空白激活态 → 与 codec 同归一，回落主仓
    act(() => {
      useWorkspaceStore.setState({
        byProject: { p1: { activePath: '  ', activeBranch: '', opened: [] } },
      });
    });
    expect(result.current).toEqual({ projectId: 'p1', worktreePath: null });
    expect(isMainCheckout(activeWorkspaceSession('p1'))).toBe(true);

    rerender({ pid: null });
    expect(result.current).toBeNull();
  });
});
