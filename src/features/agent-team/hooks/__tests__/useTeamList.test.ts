import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createTeamList, createTeamSummary } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamListStoreForTests } from '../../store/teamListStore';
import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import { PULSE_COALESCE_MS } from '../usePulseRefresh';
import { useTeamList } from '../useTeamList';

/**
 * 团队列表的失效源（**F1 的机器形式**）。
 *
 * 修之前：`useTeamPanel` 的脉冲订阅被 `if (!teamId) return` 关掉，而列表态的 `teamId`
 * 恰好是 `null`（默认态）。于是 —— 建队后点「返回列表」看到的是建队前的清单；队长经 MCP
 * 建/关队、另一个窗口的变更在列表页永不出现。**每块单独看都很好、测试也全绿**，
 * 失败是静默的。
 *
 * 现在列表自己声明「我要刷新什么」（`usePulseRefresh(load)`），订阅与去重在 store，
 * 合并窗口 / 在飞排队 / 卸载闩在共享 hook 里。本文件钉的是最要紧的一条：
 *
 * > **列表态（`teamId === null`）下收到脉冲 → `team_list` 被重取。**
 */

type ListenCb = (event: { payload: unknown }) => void;

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

let handlers: ListenCb[];

function emit(rev: number): void {
  act(() => {
    for (const handler of handlers) handler({ payload: { rev } });
  });
}

async function flush(ms = PULSE_COALESCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function countCalls(cmd: string): number {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd).length;
}

describe('useTeamList — 列表的失效源', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = [];
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async () =>
      createTeamList({ teams: [createTeamSummary({ teamId: 'tm_1' })] }),
    );
    mockListen.mockReset();
    mockListen.mockImplementation((async (_event: string, cb: ListenCb) => {
      handlers.push(cb);
      return vi.fn();
    }) as unknown as typeof listen);
    __resetTeamGenerationForTests();
    __resetTeamPulseForTests();
    // 清单面（app 级 store）：两个用例之间必须清干净，否则上一个用例的清单会漏进下一个
    __resetTeamListStoreForTests();
    // 面板的「跟随项目」：夹具团队的 projectId 是 `p1`
    useProjectStore.setState({ activeProjectId: 'p1' as ProjectId });
    // **列表态**：没有打开的团队（这正是 F1 失效的那一态）
    useTeamStore.setState({
      teamId: null,
      snapshot: null,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
  });

  it('挂载即拉一次', async () => {
    const { result } = renderHook(() => useTeamList());
    await flush(0);

    expect(countCalls('team_list')).toBe(1);
    expect(result.current.list?.teams).toHaveLength(1);
  });

  it('列表态（teamId === null）收到脉冲 → team_list 被重取（F1 的核心判据）', async () => {
    renderHook(() => useTeamList());
    await flush(0);
    expect(countCalls('team_list')).toBe(1);

    // 建队 / 关队 / 另一窗口的写都只是这一条脉冲
    emit(1);
    await flush();

    expect(countCalls('team_list')).toBe(2);
    // 列表态就是列表态：脉冲不许顺手去拉某个队的快照
    expect(mockInvoke).not.toHaveBeenCalledWith('team_snapshot', expect.anything());
  });

  it('一次动作连发 3 条脉冲 → 只重取 1 次（合并，不是 3 次全量拉取）', async () => {
    renderHook(() => useTeamList());
    await flush(0);

    // 三条脉冲**分三次**落地（每个写路径各一条，中间隔着一次渲染）：
    // 同一批里的多条会被 React 的批处理自然合并，那样这个用例就测不到合并窗口了。
    emit(1);
    await flush(0);
    emit(2);
    await flush(0);
    emit(3);
    await flush();

    expect(countCalls('team_list')).toBe(2); // 首拉 + 一次合并刷新
  });

  it('陈旧脉冲（更旧的代数）不重取', async () => {
    renderHook(() => useTeamList());
    await flush(0);

    emit(5);
    await flush();
    expect(countCalls('team_list')).toBe(2);

    emit(5);
    emit(3);
    await flush();
    expect(countCalls('team_list')).toBe(2);
  });

  it('手动刷新（列表页的「刷新」按钮）随时可重取，不依赖错误状态', async () => {
    const { result } = renderHook(() => useTeamList());
    await flush(0);

    act(() => result.current.reload());
    await flush(0);

    expect(countCalls('team_list')).toBe(2);
  });

  it('卸载后不再重取（闩：卸载时排队中的窗口也不会落地）', async () => {
    const { unmount } = renderHook(() => useTeamList());
    await flush(0);

    emit(1); // 排进合并窗口
    unmount();
    await flush();

    expect(countCalls('team_list')).toBe(1);
  });

  it('失败保留上一次成功的清单（闪空比旧数据更糟）', async () => {
    const { result } = renderHook(() => useTeamList());
    await flush(0);
    expect(result.current.list).not.toBeNull();

    mockInvoke.mockRejectedValueOnce('Failed to open the team database');
    emit(1);
    await flush();

    expect(result.current.error).toBe('Failed to open the team database');
    expect(result.current.list?.teams).toHaveLength(1);
  });

  it('只显示激活项目的团队（全量清单在 store，裁剪在本 hook）', async () => {
    mockInvoke.mockImplementation(async () =>
      createTeamList({
        teams: [
          createTeamSummary({ teamId: 'tm_p1', projectId: 'p1' }),
          createTeamSummary({ teamId: 'tm_p2', projectId: 'p2' }),
        ],
      }),
    );

    const { result } = renderHook(() => useTeamList());
    await flush(0);

    // 请求口径是「全部项目」（侧栏要列所有项目下的团队）
    expect(mockInvoke).toHaveBeenCalledWith('team_list', { projectId: null });
    expect(result.current.list?.teams.map((team) => team.teamId)).toEqual(['tm_p1']);
  });

  it('切项目 = 换视图（同一份全量清单，不重拉）', async () => {
    mockInvoke.mockImplementation(async () =>
      createTeamList({
        teams: [
          createTeamSummary({ teamId: 'tm_p1', projectId: 'p1' }),
          createTeamSummary({ teamId: 'tm_p2', projectId: 'p2' }),
        ],
      }),
    );

    const { result } = renderHook(() => useTeamList());
    await flush(0);
    const callsAfterFirst = countCalls('team_list');

    act(() => useProjectStore.setState({ activeProjectId: 'p2' as ProjectId }));

    expect(result.current.list?.teams.map((team) => team.teamId)).toEqual(['tm_p2']);
    // 清单本来就是全量的 ⇒ 切项目不靠重拉（否则切一次项目一次 IPC）
    expect(countCalls('team_list')).toBe(callsAfterFirst);
  });

  it('旧行（空 project_id，v16 之前）不出现：它无法归属到任何项目', async () => {
    mockInvoke.mockImplementation(async () =>
      createTeamList({
        teams: [
          createTeamSummary({ teamId: 'tm_legacy', projectId: '' }),
          createTeamSummary({ teamId: 'tm_p1', projectId: 'p1' }),
        ],
      }),
    );

    const { result } = renderHook(() => useTeamList());
    await flush(0);

    expect(result.current.list?.teams.map((team) => team.teamId)).toEqual(['tm_p1']);
  });

  it('没有激活项目 ⇒ 空清单（没有项目就没有可归属的团队）', async () => {
    useProjectStore.setState({ activeProjectId: null });

    const { result } = renderHook(() => useTeamList());
    await flush(0);

    expect(result.current.list?.teams).toEqual([]);
  });

  it('三个状态互相可区分（还没问到 / 失败 / 空清单）', async () => {
    // ① 还没问到：list = null 且 loading
    mockInvoke.mockImplementation(() => new Promise(() => undefined));
    const first = renderHook(() => useTeamList());
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.result.current.list).toBeNull();
    expect(first.result.current.loading).toBe(true);
    first.unmount();

    // ② 失败且从未成功：list = null 且不 loading（＋错误原文）
    __resetTeamListStoreForTests();
    mockInvoke.mockRejectedValueOnce('Failed to open the team database');
    const second = renderHook(() => useTeamList());
    await flush(0);
    expect(second.result.current.list).toBeNull();
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.error).toBe('Failed to open the team database');
    second.unmount();

    // ③ 空清单：list 有值、teams 为空（不是 null）
    __resetTeamListStoreForTests();
    mockInvoke.mockImplementation(async () => createTeamList({ teams: [] }));
    const third = renderHook(() => useTeamList());
    await flush(0);
    expect(third.result.current.list?.teams).toEqual([]);
    expect(third.result.current.error).toBeNull();
  });
});
