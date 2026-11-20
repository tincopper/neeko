import { describe, expect, it } from 'vitest';

import { createTaskCard } from '@/testing/factories';

import { LEASE_URGENT_SECS, leaseText, remainingSecsOf, taskLease } from '../leaseText';

/**
 * 租约文案的**唯一**实现。
 *
 * 两条判据：
 *
 * 1. **两态不可合并**：`<= 0`（已超时）/ `> 0`（剩余）是两件事，合成一句会让
 *    「租约已经过期」看起来像正常剩余；`null`（没有租约）由调用方**不渲染**这一行
 *    （R3：不再恒亮「无在飞任务」），因此不在这里的输入域里；
 * 2. **两个读面同格式**：花名册吃后端快照值（`leaseRemainingSecs`）、卡片与抽屉吃现算的
 *    实时值（`remainingSecsOf`）。它们的**来源**不同（一个随脉冲更新、一个每秒 tick），
 *    但同一个剩余秒必须给出同一句话 —— 否则同一个任务在两处说两个数字。
 */
describe('leaseText — 租约两态', () => {
  it('<= 0 = 已超时（与「没有租约」是两件事：后者根本不渲染），且紧急', () => {
    expect(leaseText(0)).toEqual({ text: 'Lease expired', urgent: true });
    expect(leaseText(-5)).toEqual({ text: 'Lease expired', urgent: true });
  });

  it('> 0 时给出 mm:ss（秒补零）', () => {
    expect(leaseText(90).text).toBe('Lease 1:30');
    expect(leaseText(1800).text).toBe('Lease 30:00');
    expect(leaseText(61).text).toBe('Lease 1:01');
  });

  it('不足 2 分钟算紧急（回收是静默发生的，得提前有一抹颜色）', () => {
    expect(LEASE_URGENT_SECS).toBe(120);
    expect(leaseText(LEASE_URGENT_SECS).urgent).toBe(true);
    expect(leaseText(LEASE_URGENT_SECS + 1).urgent).toBe(false);
  });
});

describe('remainingSecsOf — 卡片 / 抽屉的输入', () => {
  const NOW = 1_700_000_000_000;

  it('没有起租就没有租约（null 而不是 0）', () => {
    expect(remainingSecsOf(createTaskCard({ id: 't1' }), NOW)).toBeNull();
  });

  it('由 claimedAt + leaseTtl 现算，向上取整（刚过期几毫秒仍是 0，不是 1）', () => {
    const task = createTaskCard({ id: 't1', claimedAt: NOW, leaseTtl: 60 });
    expect(remainingSecsOf(task, NOW)).toBe(60);
    expect(remainingSecsOf(task, NOW + 500)).toBe(60); // 59.5s → 60（向上取整）
    expect(remainingSecsOf(task, NOW + 60_000)).toBe(0);
    expect(remainingSecsOf(task, NOW + 60_001)).toBe(0); // -1ms → 0，仍是「超时」
  });
});

describe('两个读面同格式（同源判据）', () => {
  const NOW = 1_700_000_000_000;

  it('快照值（花名册）与现算值（卡片）对同一个剩余秒给出**同一句话**', () => {
    const task = createTaskCard({ id: 't1', claimedAt: NOW, leaseTtl: 1374 });
    const fromCard = taskLease(task, NOW);
    // 花名册的 `leaseRemainingSecs` 就是后端算好的同一个剩余秒
    const fromRoster = leaseText(remainingSecsOf(task, NOW));
    expect(fromCard).toEqual(fromRoster);
    expect(fromCard?.text).toBe('Lease 22:54');
  });

  it('taskLease 只对「没有租约」返回 null（其余一律走同一份 leaseText）', () => {
    expect(taskLease(createTaskCard({ id: 't1' }), NOW)).toBeNull();
    expect(
      taskLease(createTaskCard({ id: 't2', claimedAt: NOW, leaseTtl: 30 }), NOW + 31_000),
    ).toEqual(leaseText(-1));
  });
});
