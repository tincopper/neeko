import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTeamList, createTeamSummary } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamListStoreForTests, useTeamListStore } from '../teamListStore';

/**
 * 团队清单的**读面**（`team_list`）。
 *
 * 四条判据都是「副作用式」的现场故障：
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 三态分离（未问到 / 失败 / 空清单）| 加载中显示空态 = 谎称「团队都没了」|
 * | 失败不清空 | 一次瞬时故障让清单闪空，用户以为团队被删了 |
 * | 代数守卫 | 侧栏 + 面板 + 脉冲并发刷新，晚到的旧响应把新清单盖回去 |
 * | `applyPulse` 去重 | 一次动作连发多条脉冲 ⇒ 每条都重取一遍 |
 *
 * 请求口径钉的是 `projectId: null`：**全部项目**。用「激活项目」顶替会让侧栏漏掉别的项目
 * 下的团队 —— 而它们确实在这台机器上（过滤属于消费侧）。
 */

const mockInvoke = vi.mocked(invoke);

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('teamListStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    __resetTeamListStoreForTests();
  });

  it('拉全部项目的清单（projectId 恒为 null，不是激活项目）', async () => {
    const list = createTeamList({
      teams: [
        createTeamSummary({ teamId: 'tm_1', projectId: 'p1' }),
        createTeamSummary({ teamId: 'tm_2', projectId: 'p2' }),
      ],
    });
    mockInvoke.mockResolvedValue(list);

    await useTeamListStore.getState().refresh();

    expect(mockInvoke).toHaveBeenCalledWith('team_list', { projectId: null });
    expect(useTeamListStore.getState().list?.teams.map((t) => t.teamId)).toEqual(['tm_1', 'tm_2']);
    expect(useTeamListStore.getState().loading).toBe(false);
    expect(useTeamListStore.getState().error).toBeNull();
  });

  it('首拉期间是「还没问到」：loading 且 list 仍为 null（不是空清单）', async () => {
    const hold = deferred<void>();
    mockInvoke.mockImplementation(async () => {
      await hold.promise;
      return createTeamList();
    });

    const first = useTeamListStore.getState().refresh();
    // 断言「还没有任何数据」：空态与加载中必须可区分
    expect(useTeamListStore.getState().loading).toBe(true);
    expect(useTeamListStore.getState().list).toBeNull();

    hold.resolve();
    await first;
    expect(useTeamListStore.getState().loading).toBe(false);
    expect(useTeamListStore.getState().list?.teams).toHaveLength(1);
  });

  it('失败且从未成功 ⇒ list 仍为 null + 后端原文', async () => {
    mockInvoke.mockRejectedValueOnce('Failed to open the team database');

    await useTeamListStore.getState().refresh();

    expect(useTeamListStore.getState().list).toBeNull();
    expect(useTeamListStore.getState().loading).toBe(false);
    expect(useTeamListStore.getState().error).toBe('Failed to open the team database');
  });

  it('成功之后再失败 ⇒ **不清空**上一次成功的清单（闪空比旧数据更糟）', async () => {
    const list = createTeamList({ teams: [createTeamSummary({ teamId: 'tm_1' })] });
    mockInvoke.mockResolvedValueOnce(list);
    await useTeamListStore.getState().refresh();

    mockInvoke.mockRejectedValueOnce('Failed to open the team database');
    await useTeamListStore.getState().refresh();

    expect(useTeamListStore.getState().list).toEqual(list);
    expect(useTeamListStore.getState().error).toBe('Failed to open the team database');
    expect(useTeamListStore.getState().loading).toBe(false);
  });

  it('陈旧响应不覆盖新响应（先发的那次晚到 ⇒ 丢弃）', async () => {
    const slow = deferred<unknown>();
    let call = 0;
    mockInvoke.mockImplementation(async () => {
      call += 1;
      if (call === 1) return slow.promise;
      return createTeamList({ teams: [createTeamSummary({ teamId: 'tm_new' })] });
    });

    const first = useTeamListStore.getState().refresh();
    await useTeamListStore.getState().refresh();
    slow.resolve(createTeamList({ teams: [createTeamSummary({ teamId: 'tm_old' })] }));
    await first;

    expect(useTeamListStore.getState().list?.teams.map((t) => t.teamId)).toEqual(['tm_new']);
    expect(useTeamListStore.getState().loading).toBe(false);
  });

  it('applyPulse 只接受更大的 rev（一次动作会连发多条脉冲）', () => {
    const { applyPulse } = useTeamListStore.getState();

    expect(applyPulse(3)).toBe(true);
    expect(useTeamListStore.getState().lastRev).toBe(3);
    // 同一代数再来一次 / 更旧的脉冲（乱序到达）→ 忽略，且不把水位推回去
    expect(applyPulse(3)).toBe(false);
    expect(applyPulse(2)).toBe(false);
    expect(useTeamListStore.getState().lastRev).toBe(3);
    expect(applyPulse(4)).toBe(true);
    expect(useTeamListStore.getState().lastRev).toBe(4);
  });
});
