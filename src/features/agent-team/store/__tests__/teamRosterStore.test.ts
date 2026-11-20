import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTeamStore } from '@/features/agent-team/store/teamStore';
import type { TeamSnapshot } from '@/shared/types/team';
import { createMemberStatus, createTeamSnapshot } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamRosterStoreForTests, useTeamRosterStore } from '../teamRosterStore';

/**
 * 侧栏花名册的**按队缓存**（展开才拉）。
 *
 * 四条判据都是「不这么写就静默坏一次」的现场故障：
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | `ensure` 幂等（同队一次请求）| 折叠再展开每次都重拉整个快照（≤200 张任务卡片）|
 * | 并发 `ensure` 只发一次 | 展开 + 脉冲同一帧命中 ⇒ 同一个队两条在飞快照，乱序落地 |
 * | 失败不清空上次成功 | 一次瞬时故障让成员列表闪空（「团队的人都没了」）|
 * | 脉冲标脏而不是删除 | 同上，而且没有东西会把删掉的条目再拉回来 |
 * | 不碰 `teamStore` | 侧栏展开 A 队把面板切到 A（AC4）|
 */

const mockInvoke = vi.mocked(invoke);

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function snapshot(teamId: string, memberIds: string[]): TeamSnapshot {
  return createTeamSnapshot({
    members: memberIds.map((memberId) => createMemberStatus({ memberId })),
    memberCount: memberIds.length,
  });
}

function rosterNames(teamId: string): string[] {
  return useTeamRosterStore.getState().rosters[teamId]?.members.map((m) => m.memberId) ?? [];
}

describe('teamRosterStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    __resetTeamRosterStoreForTests();
  });

  it('拉一次 `team_snapshot`，只留花名册（成员 + 成员数）', async () => {
    mockInvoke.mockResolvedValue(snapshot('tm_1', ['lead@tm_1', 'w1@tm_1']));

    await useTeamRosterStore.getState().ensure('tm_1');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' });
    expect(rosterNames('tm_1')).toEqual(['lead@tm_1', 'w1@tm_1']);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.memberCount).toBe(2);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.loading).toBe(false);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.error).toBeNull();
  });

  it('幂等：已经拉过就不再发请求（折叠再展开不重拉，AC3）', async () => {
    mockInvoke.mockResolvedValue(snapshot('tm_1', ['w1@tm_1']));

    await useTeamRosterStore.getState().ensure('tm_1');
    await useTeamRosterStore.getState().ensure('tm_1');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('两个队互不影响（缓存按 id 键控）', async () => {
    mockInvoke.mockImplementation(async (_cmd, args) =>
      snapshot((args as { teamId: string }).teamId, [`${(args as { teamId: string }).teamId}-w1`]),
    );

    await Promise.all([
      useTeamRosterStore.getState().ensure('tm_a'),
      useTeamRosterStore.getState().ensure('tm_b'),
    ]);

    expect(rosterNames('tm_a')).toEqual(['tm_a-w1']);
    expect(rosterNames('tm_b')).toEqual(['tm_b-w1']);
  });

  it('并发的两次 `ensure`（展开 + 脉冲同帧）只发一次请求', async () => {
    const hold = deferred<TeamSnapshot>();
    mockInvoke.mockReturnValue(hold.promise);

    const first = useTeamRosterStore.getState().ensure('tm_1');
    const second = useTeamRosterStore.getState().ensure('tm_1');
    hold.resolve(snapshot('tm_1', ['w1@tm_1']));
    await Promise.all([first, second]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(rosterNames('tm_1')).toEqual(['w1@tm_1']);
  });

  it('失败保留上次成功的成员（闪空比旧数据更糟），只写错误', async () => {
    mockInvoke.mockResolvedValueOnce(snapshot('tm_1', ['w1@tm_1']));
    await useTeamRosterStore.getState().ensure('tm_1');

    // 失效后重取失败：成员仍在，错误可见。
    useTeamRosterStore.getState().invalidateAll();
    mockInvoke.mockRejectedValueOnce(new Error('endpoint down'));
    await useTeamRosterStore.getState().ensure('tm_1');

    expect(rosterNames('tm_1')).toEqual(['w1@tm_1']);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.error).toContain('endpoint down');
    expect(useTeamRosterStore.getState().rosters['tm_1']?.loading).toBe(false);
  });

  it('失败后再次 `ensure` 会重试（折叠再展开是用户的重试动作）', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('first failure'));
    await useTeamRosterStore.getState().ensure('tm_1');
    expect(useTeamRosterStore.getState().rosters['tm_1']?.error).toContain('first failure');

    mockInvoke.mockResolvedValueOnce(snapshot('tm_1', ['w1@tm_1']));
    await useTeamRosterStore.getState().ensure('tm_1');

    expect(rosterNames('tm_1')).toEqual(['w1@tm_1']);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.error).toBeNull();
  });

  it('`invalidateAll` 把已缓存的队标脏（脉冲的唯一失效源）', async () => {
    mockInvoke.mockResolvedValueOnce(snapshot('tm_1', ['w1@tm_1']));
    await useTeamRosterStore.getState().ensure('tm_1');

    useTeamRosterStore.getState().invalidateAll();

    const entry = useTeamRosterStore.getState().rosters['tm_1'];
    expect(entry?.stale).toBe(true);
    // 标脏而不是删除：重取期间上一次成功的结果仍在屏幕上。
    expect(entry?.members.map((m) => m.memberId)).toEqual(['w1@tm_1']);

    // 标脏后再 `ensure` 会真的重取。
    mockInvoke.mockResolvedValueOnce(snapshot('tm_1', ['w1@tm_1', 'w2@tm_1']));
    await useTeamRosterStore.getState().ensure('tm_1');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(rosterNames('tm_1')).toEqual(['w1@tm_1', 'w2@tm_1']);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.stale).toBe(false);
  });

  it('脉冲打断在飞请求 ⇒ 丢弃陈旧响应并重新标脏（界面不会停在脉冲前那一版）', async () => {
    const hold = deferred<TeamSnapshot>();
    mockInvoke.mockReturnValue(hold.promise);

    const inflight = useTeamRosterStore.getState().ensure('tm_1');
    // 落库前的响应属于上一代：丢弃，但条目要交回「可重取」状态。
    useTeamRosterStore.getState().invalidateAll();
    hold.resolve(snapshot('tm_1', ['stale-w1@tm_1']));
    await inflight;

    expect(rosterNames('tm_1')).toEqual([]);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.stale).toBe(true);
    expect(useTeamRosterStore.getState().rosters['tm_1']?.loading).toBe(false);
  });

  it('绝不碰 `teamStore`（侧栏展开不能把面板切到别的队，AC4）', async () => {
    useTeamStore.setState({ teamId: 'tm_panel', snapshot: null, loading: false, error: null });
    mockInvoke.mockResolvedValue(snapshot('tm_1', ['w1@tm_1']));

    await useTeamRosterStore.getState().ensure('tm_1');
    useTeamRosterStore.getState().invalidateAll();

    expect(useTeamStore.getState().teamId).toBe('tm_panel');
  });
});
