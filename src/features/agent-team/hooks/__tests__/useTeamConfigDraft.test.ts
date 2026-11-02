import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TeamOptions } from '@/shared/types/team';
import { createLaunchableAgent, createTeamDefaults, createTeamOptions } from '@/testing/factories';

import { useTeamConfigDraft } from '../useTeamConfigDraft';

/**
 * 配置草稿的**提交语义**。
 *
 * 本文件钉住一条容易在「放宽校验」的改动里被静默反转的语义：
 *
 * > 成员池**空 = 不限制**（后端 `TeamConfig.allowedAgentIds` 的注释：空池是「不限制」而不是
 * > 「一个都不许」）。
 *
 * 于是「用户把勾全取消」这件事的后端含义是「不限制任何 CLI」—— 比默认值更宽。前端因此在
 * `valid` 里要求**至少勾一个**：不是「空池非法」，而是「空勾选不能被当成本地决定提交出去」。
 * 哪天有人为了让「全不勾也能提交」而删掉这条判据，用户会在不知情的情况下把一个受限制的队
 * 变成不限成员 —— 而且没有任何一处报错。下面两条断言就是那个反转的报警器。
 */

function options(): TeamOptions {
  return createTeamOptions({
    members: [
      createLaunchableAgent({ agentId: 'claude-code' }),
      createLaunchableAgent({ agentId: 'qoder' }),
    ],
    defaults: createTeamDefaults({
      // 故意不是前端常量：默认值只能来自这里（4 / shared / queue 是后端缺省）
      allowedAgentIds: ['claude-code', 'qoder'],
      maxMembers: 4,
    }),
  });
}

describe('useTeamConfigDraft — 空勾选的语义是「不限制」', () => {
  /**
   * 稳定的 `TeamOptions` 引用（每个用例一次）。
   *
   * 草稿在 `options.defaults` 换了引用时重新播种 —— 这是有意的（`reload` 意味着后端默认值
   * 变了）。所以测试里不能写成 `renderHook(() => useTeamConfigDraft(options()))`：那会每次
   * 渲染都造一个新对象，播种 effect 与渲染互相触发，直接死循环。
   */
  const opts = options();

  it('初值来自后端 defaults（前端没有第二份默认值）', () => {
    const { result } = renderHook(() => useTeamConfigDraft(opts));

    expect(result.current.values?.selectedIds).toEqual(['claude-code', 'qoder']);
    expect(result.current.values?.maxMembers).toBe('4');
    // 什么都没改 ⇒ 载荷是空的（缺省即后端默认，不把默认值抄成前端常量）
    expect(result.current.config).toEqual({});
    expect(result.current.valid).toBe(true);
  });

  it('全不勾 ⇒ `valid` 为 false（否则「不限制」会被静默提交出去）', () => {
    const { result } = renderHook(() => useTeamConfigDraft(opts));

    act(() => result.current.toggleMember('claude-code', false));
    act(() => result.current.toggleMember('qoder', false));

    expect(result.current.values?.selectedIds).toEqual([]);
    // 空池在**后端**的含义是「不限制」⇒ 它比默认值更宽，不能由一次「取消勾选」隐式达成
    expect(result.current.valid).toBe(false);
    // 载荷本身仍是诚实的：空数组就是「不限制」这个意图（判断该不该发它，是 `valid` 的事）
    expect(result.current.config.allowedAgentIds).toEqual([]);
  });

  it('只勾回一个 ⇒ 重新可提交，且载荷只有这一项', () => {
    const { result } = renderHook(() => useTeamConfigDraft(opts));

    act(() => result.current.toggleMember('claude-code', false));
    act(() => result.current.toggleMember('qoder', false));
    act(() => result.current.toggleMember('qoder', true));

    expect(result.current.valid).toBe(true);
    expect(result.current.config).toEqual({ allowedAgentIds: ['qoder'] });
  });

  it('上限越界 ⇒ `valid` 为 false，且载荷里不出现 `maxMembers`（不发必然被拒的请求）', () => {
    const { result } = renderHook(() => useTeamConfigDraft(opts));

    act(() => result.current.setMaxMembers('99'));

    expect(result.current.maxMembersError).not.toBeNull();
    expect(result.current.valid).toBe(false);
    expect(result.current.config.maxMembers).toBeUndefined();
  });

  it('缺省值还没到（`options === null`）：草稿为 null、不可提交（不猜默认值）', () => {
    const { result } = renderHook(() => useTeamConfigDraft(null));

    expect(result.current.values).toBeNull();
    expect(result.current.valid).toBe(false);
    expect(result.current.config).toEqual({});
  });
});
