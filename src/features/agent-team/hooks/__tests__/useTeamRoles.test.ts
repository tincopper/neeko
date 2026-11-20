import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RolePreset } from '@/shared/types/team';
import { invoke } from '@/testing/tauriCore';

import { useTeamRoles } from '../useTeamRoles';

/**
 * 角色库数据面的三条判据（与 `useTeamList` 同一纪律族）。
 *
 * 1. **三态分离**：`null && loading` = 没问到；`null && !loading` = 失败且从未成功；
 *    `[]` = 库真的空。三者混成一种会让「读不到」看起来像「没有预设」。
 * 2. **失败不清空**：闪空比旧数据更糟。
 * 3. **错误原文走返回值**：`mutationError` 是异步 setState，调用方 `await` 之后回读
 *    拿到的是闭包旧值（这正是「保存失败却显示兜底文案」的成因）—— 所以 `saveRole` /
 *    `deleteRole` 必须把错误放在返回对象里。
 */

const mockInvoke = vi.mocked(invoke);

/** 冲刷挂载 effect 里的在飞 promise（mock 立即 resolve，一次微任务队列即可）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function role(overrides?: Partial<RolePreset>): RolePreset {
  return {
    name: '研究员',
    preamble: 'Research only.',
    cliPreference: null,
    approvalPolicy: null,
    defaultWorkspace: null,
    createdAt: 1,
    ...overrides,
  };
}

/** 让 `team_role_list` 回给定的清单（其余命令交给各用例自己的实现）。 */
function mockList(roles: RolePreset[], truncated = false): void {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'team_role_list') return { roles, truncated };
    return undefined;
  });
}

describe('useTeamRoles', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('挂载后拉到清单（`roles` 落地、`loading` 收束）', async () => {
    mockList([role()]);
    const { result } = renderHook(() => useTeamRoles());
    await flush();

    expect(result.current.roles).toEqual([role()]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.rolesTruncated).toBe(false);
  });

  it('后端置位 truncated ⇒ hook 透出（UI 才说得出来）', async () => {
    mockList([role()], true);
    const { result } = renderHook(() => useTeamRoles());
    await flush();

    expect(result.current.rolesTruncated).toBe(true);
  });

  it('首次读取失败：`roles` 保持 null、`error` 是原文（不伪造空库）', async () => {
    mockInvoke.mockImplementation(async () => {
      throw new Error('manager offline');
    });
    const { result } = renderHook(() => useTeamRoles());
    await flush();

    expect(result.current.roles).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain('manager offline');
  });

  it('成功之后再失败：不清空上一次的清单（闪空比旧数据更糟）', async () => {
    mockList([role()]);
    const { result } = renderHook(() => useTeamRoles());
    await flush();
    expect(result.current.roles).toEqual([role()]);

    mockInvoke.mockImplementation(async () => {
      throw new Error('manager offline');
    });
    await act(async () => {
      result.current.reload();
    });
    await flush();

    expect(result.current.error).toContain('manager offline');
    expect(result.current.roles).toEqual([role()]);
  });

  it('保存成功 ⇒ `{ ok: true }`，并重取清单（新角色进所有下拉）', async () => {
    const saved = role({ name: '评审' });
    let listCalls = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'team_role_list') {
        listCalls += 1;
        return { roles: listCalls === 1 ? [] : [saved], truncated: false };
      }
      return undefined;
    });
    const { result } = renderHook(() => useTeamRoles());
    await flush();
    expect(result.current.roles).toEqual([]);

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.saveRole(saved);
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.roles).toEqual([saved]);
    expect(result.current.mutationError).toBeNull();
  });

  it('保存失败 ⇒ 返回值带错误原文（不靠调用方回读 state）', async () => {
    mockList([]);
    const { result } = renderHook(() => useTeamRoles());
    await flush();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'team_role_save') throw new Error('preamble too long');
      if (cmd === 'team_role_list') return { roles: [], truncated: false };
      return undefined;
    });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.saveRole(role());
    });

    // 关键：返回值里就有原文 —— 调用方在同一 tick 就能拿到它
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('preamble too long');
    // state 也同步了（管理面的错误条要用）
    expect(result.current.mutationError).toContain('preamble too long');
  });

  it('删除失败 ⇒ 返回值带错误原文', async () => {
    mockList([role()]);
    const { result } = renderHook(() => useTeamRoles());
    await flush();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'team_role_delete') throw new Error('unknown persona');
      if (cmd === 'team_role_list') return { roles: [role()], truncated: false };
      return undefined;
    });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.deleteRole('研究员');
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('unknown persona');
  });
});
