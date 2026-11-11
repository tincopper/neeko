import { describe, expect, it } from 'vitest';

import { createLaunchableAgent } from '@/testing/factories';

import { convergeAgentId, isLaunchable, launchGate, startableAgentIds } from '../launchGate';

/**
 * 队长入口的提交判定。
 *
 * 判据不是「四条 `&&` 拼起来对不对」，而是**每一条否决来源都能单独把按钮打掉**，
 * 并且各自的理由不会被别条遮蔽（尤其是 v16 那条：没有激活项目 ⇒ 执行环境无处可取，
 * 后端会在写库之前拒绝）。
 */

const OK = createLaunchableAgent({ agentId: 'claude-code' });
const REFUSED = createLaunchableAgent({
  agentId: 'pi',
  refusal: 'Unsupported: agent `pi` injects MCP via Subcommand',
});

/** 全部满足的输入；每个用例只改它关心的那一项。 */
function input(overrides: Partial<Parameters<typeof launchGate>[0]> = {}) {
  return {
    hasActiveProject: true,
    hasWorkspaceRoot: true,
    launchable: [OK],
    agentId: 'claude-code',
    draftValid: true,
    busy: false,
    ...overrides,
  };
}

describe('launchGate', () => {
  it('全部满足时可启动', () => {
    const gate = launchGate(input());
    expect(gate.canStart).toBe(true);
    expect(gate.blockedReason).toBeNull();
  });

  it('没有激活项目：不可启动，理由点名项目（这是执行环境的归属，不是路径）', () => {
    const gate = launchGate(input({ hasActiveProject: false }));
    expect(gate.canStart).toBe(false);
    // 理由必须是**可见文字**（禁用的按钮不可聚焦），所以它只能从返回值里出。
    expect(gate.blockedReason).toContain('没有活动项目');
    expect(gate.blockedReason).toContain('项目');
  });

  it('项目优先于其它理由（有根但没项目时不得说「先选择一个项目」以外的话）', () => {
    const gate = launchGate(input({ hasActiveProject: false, hasWorkspaceRoot: false }));
    expect(gate.blockedReason).toContain('团队的执行环境属于项目');
  });

  it('有项目但没有工作区根：不可启动，理由说的是**工作区根**（不是「没有活动项目」）', () => {
    const gate = launchGate(input({ hasWorkspaceRoot: false }));
    expect(gate.canStart).toBe(false);
    // 名词必须与缺失的条件对应：用户明明有项目，告诉他「先选择一个项目」会让他去改一个
    // 已经满足的条件（这句话此前就是从上一个分支复制粘贴来的）。
    expect(gate.blockedReason).toContain('工作区根');
    expect(gate.blockedReason).not.toContain('没有活动项目');
  });

  it('两条 blocked 理由必须互不相同（复制粘贴会让用户去修一个已经满足的条件）', () => {
    const noProject = launchGate(input({ hasActiveProject: false })).blockedReason;
    const noRoot = launchGate(input({ hasWorkspaceRoot: false })).blockedReason;

    expect(noRoot).not.toBe(noProject);
    // 各自的特征词：项目那条必须提「项目」，工作区根那条必须提「工作区根」
    expect(noProject).toContain('项目');
    expect(noRoot).toContain('工作区根');
  });

  it('清单还没拿到（null）：不可启动，但不重复解释（选择器上方已经说过）', () => {
    const gate = launchGate(input({ launchable: null, agentId: null }));
    expect(gate.canStart).toBe(false);
    expect(gate.blockedReason).toBeNull();
    expect(gate.startableIds).toEqual([]);
  });

  it('清单里一个都不能启动：不可启动并说明原因', () => {
    const gate = launchGate(input({ launchable: [REFUSED], agentId: null }));
    expect(gate.canStart).toBe(false);
    expect(gate.blockedReason).toContain('都不能启动');
  });

  it('选中的 CLI 在刷新后变成被拒：不可启动（不是「非 null 就算选中」）', () => {
    const gate = launchGate(input({ launchable: [OK, REFUSED], agentId: 'pi' }));
    expect(gate.canStart).toBe(false);
    expect(gate.startableIds).toEqual(['claude-code']);
  });

  it('配置草稿不可提交 / 正在提交：不可启动（必然被后端拒绝的请求不发）', () => {
    expect(launchGate(input({ draftValid: false })).canStart).toBe(false);
    expect(launchGate(input({ busy: true })).canStart).toBe(false);
  });
});

describe('startableAgentIds / isLaunchable', () => {
  it('只保留 refusal === null 的行，顺序即后端给的行序（不再排）', () => {
    const rows = [
      createLaunchableAgent({ agentId: 'z-code' }),
      REFUSED,
      createLaunchableAgent({ agentId: 'a-code' }),
    ];
    expect(startableAgentIds(rows)).toEqual(['z-code', 'a-code']);
  });

  it('null ⇒ 空清单（不是「全都能起」）', () => {
    expect(startableAgentIds(null)).toEqual([]);
  });

  it('拒因只要非 null 就算不能起（空串也是拒：不是「没有理由」）', () => {
    expect(isLaunchable(createLaunchableAgent({ agentId: 'x', refusal: '' }))).toBe(false);
    expect(isLaunchable(OK)).toBe(true);
  });
});

describe('convergeAgentId — 选择收敛在渲染期完成', () => {
  it('已选且仍可启动 → 保持（用户的选择不被抢走）', () => {
    expect(convergeAgentId('qoder', ['claude-code', 'qoder'])).toBe('qoder');
  });

  it('已选但被拒（清单刷新后）→ 落到第一个可启动的', () => {
    expect(convergeAgentId('pi', ['claude-code', 'qoder'])).toBe('claude-code');
  });

  it('没选过 → 第一个可启动的；一个都没有 → null', () => {
    expect(convergeAgentId(null, ['claude-code'])).toBe('claude-code');
    expect(convergeAgentId(null, [])).toBeNull();
    expect(convergeAgentId('pi', [])).toBeNull();
  });
});
