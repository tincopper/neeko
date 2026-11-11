import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamSnapshot } from '@/shared/types/team';
import { createTeam, createTeamSnapshot } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../teamStore';

const mockInvoke = vi.mocked(invoke);

const EMPTY = {
  teamId: null,
  snapshot: null,
  detail: null,
  loading: false,
  error: null,
  lastRev: 0,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('teamStore', () => {
  beforeEach(() => {
    __resetTeamGenerationForTests();
    useTeamStore.setState(EMPTY);
    mockInvoke.mockReset();
  });

  it('openTeam 设 id 并拉一次快照', async () => {
    const snapshot = createTeamSnapshot();
    mockInvoke.mockImplementation(async (cmd) => (cmd === 'team_snapshot' ? snapshot : undefined));

    await useTeamStore.getState().openTeam('tm_1');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' });
    expect(useTeamStore.getState().teamId).toBe('tm_1');
    expect(useTeamStore.getState().snapshot).toEqual(snapshot);
    expect(useTeamStore.getState().loading).toBe(false);
    expect(useTeamStore.getState().error).toBeNull();
  });

  it('换队时丢弃上一个团队的在飞响应（陈旧快照不许覆盖新快照）', async () => {
    const slow = deferred<TeamSnapshot>();
    mockInvoke.mockImplementation(async (_cmd, args) => {
      const teamId = (args as { teamId: string }).teamId;
      if (teamId === 'tm_a') return slow.promise;
      return createTeamSnapshot({ team: createTeam({ id: 'tm_b', name: 'beta' }) });
    });

    const first = useTeamStore.getState().openTeam('tm_a');
    await useTeamStore.getState().openTeam('tm_b');
    slow.resolve(createTeamSnapshot({ team: createTeam({ id: 'tm_a', name: 'alpha' }) }));
    await first;

    expect(useTeamStore.getState().teamId).toBe('tm_b');
    expect(useTeamStore.getState().snapshot?.team.id).toBe('tm_b');
  });

  it('applyPulse 只接受更大的 rev（一次动作会连发多条脉冲）', () => {
    const { applyPulse } = useTeamStore.getState();

    expect(applyPulse(3)).toBe(true);
    expect(useTeamStore.getState().lastRev).toBe(3);
    // 同一代数再来一次 → 不再触发重取
    expect(applyPulse(3)).toBe(false);
    // 更旧的脉冲（乱序到达）→ 忽略，且不得把水位线推回去
    expect(applyPulse(2)).toBe(false);
    expect(useTeamStore.getState().lastRev).toBe(3);
    expect(applyPulse(4)).toBe(true);
    expect(useTeamStore.getState().lastRev).toBe(4);
  });

  it('refresh 失败时保留上一次快照并暴露后端原文（闪空比旧数据更糟）', async () => {
    const snapshot = createTeamSnapshot();
    mockInvoke.mockResolvedValueOnce(snapshot);
    await useTeamStore.getState().openTeam('tm_1');

    mockInvoke.mockRejectedValueOnce('Not found: team `tm_1` is not loaded');
    await useTeamStore.getState().refresh();

    expect(useTeamStore.getState().snapshot).toEqual(snapshot);
    expect(useTeamStore.getState().error).toBe('Not found: team `tm_1` is not loaded');
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('没有 teamId 时 refresh 不发 invoke', async () => {
    await useTeamStore.getState().refresh();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('closeTeam 回到空态（面板据此显示队长入口）', async () => {
    mockInvoke.mockResolvedValue(createTeamSnapshot());
    await useTeamStore.getState().openTeam('tm_1');

    useTeamStore.getState().closeTeam();

    expect(useTeamStore.getState()).toMatchObject(EMPTY);
  });
});
