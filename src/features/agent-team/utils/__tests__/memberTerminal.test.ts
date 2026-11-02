import { describe, expect, it } from 'vitest';

import { createMemberStatus } from '@/testing/factories';

import { openTerminalAction } from '../memberTerminal';

/**
 * 「打开终端」的判据。
 *
 * 两条都必须成立：`terminalId != null` 才能开；开不了时有一个**可见**理由（不是只进 title ——
 * `disabled` 元素不可聚焦，键盘与读屏用户拿不到它）。
 */
describe('openTerminalAction', () => {
  it('有 terminalId：可点，且不带理由', () => {
    const action = openTerminalAction(createMemberStatus({ memberId: 'w1@tm_1' }));
    expect(action).toEqual({ enabled: true, label: '打开终端', reason: null });
  });

  it('terminalId 为 null：置灰，并给出可见理由「暂无终端」', () => {
    const action = openTerminalAction(
      createMemberStatus({ memberId: 'w1@tm_1', terminalId: null }),
    );
    expect(action.enabled).toBe(false);
    // 文案是中性措辞：`null` 只说「此刻没有可接管的终端」，不等于「没有进程」
    // （将来接 Chat 类成员时它们本来就没有 PTY，见 `memberTerminal` 的扩展点注释）。
    expect(action.reason).toBe('暂无终端');
    // 按钮文案保持不变：变的是「能不能点」，理由单独说 —— 否则按钮自己变成理由，动作就没了
    expect(action.label).toBe('打开终端');
  });

  it('判据只看 terminalId（role / state 都不影响能不能看到终端）', () => {
    const lead = openTerminalAction(
      createMemberStatus({ memberId: 'lead@tm_1', role: 'lead', terminalId: 'term-lead' }),
    );
    const dead = openTerminalAction(
      createMemberStatus({ memberId: 'w2@tm_1', state: 'dead', terminalId: 'term-dead' }),
    );
    // 队长没有特权，已退出的成员也不在这里预判 —— 点了会得到终端的可读错误
    expect(lead.enabled).toBe(true);
    expect(dead.enabled).toBe(true);
  });
});
