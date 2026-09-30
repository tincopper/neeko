import { describe, expect, it } from 'vitest';

import { createRetryBudget, type RetryPolicy } from '../retryBudget';

const POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 350 };

describe('createRetryBudget — 有界重试的纯策略', () => {
  it('首次尝试立即执行（delayMs = 0），此后指数退避', () => {
    const budget = createRetryBudget(POLICY);
    expect(budget.acquire('k')).toEqual({ attempt: 1, delayMs: 0 });
    expect(budget.acquire('k')).toEqual({ attempt: 2, delayMs: 100 });
    expect(budget.acquire('k')).toEqual({ attempt: 3, delayMs: 200 });
  });

  it('退避被 maxDelayMs 封顶（不得无界增长）', () => {
    const budget = createRetryBudget({ maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 250 });
    const delays = [1, 2, 3, 4, 5, 6].map(() => budget.acquire('k')?.delayMs);
    expect(delays).toEqual([0, 100, 200, 250, 250, 250]);
  });

  it('预算耗尽后返回 null，且不因继续调用而恢复（重试必须有界）', () => {
    const budget = createRetryBudget({ maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 });
    expect(budget.acquire('k')?.attempt).toBe(1);
    expect(budget.acquire('k')?.attempt).toBe(2);
    expect(budget.acquire('k')).toBeNull();
    expect(budget.acquire('k')).toBeNull();
  });

  it('maxAttempts = 1 表示不重试：第二次即耗尽', () => {
    const budget = createRetryBudget({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 });
    expect(budget.acquire('k')?.attempt).toBe(1);
    expect(budget.acquire('k')).toBeNull();
  });

  it('意图切换 ⇒ 预算自动归零（新意图拿到完整预算，旧意图不残留状态）', () => {
    const budget = createRetryBudget(POLICY);
    budget.acquire('a');
    budget.acquire('a');
    expect(budget.acquire('b')).toEqual({ attempt: 1, delayMs: 0 });
  });

  it('release 归还预算：同一意图重新从头计数（已收敛 / 请求未发出）', () => {
    const budget = createRetryBudget(POLICY);
    budget.acquire('k');
    budget.acquire('k');
    budget.release('k');
    expect(budget.acquire('k')).toEqual({ attempt: 1, delayMs: 0 });
  });

  it('release 只作用于当前意图（传其它意图是无操作，避免误清正在收敛的预算）', () => {
    const budget = createRetryBudget(POLICY);
    budget.acquire('k');
    budget.release('other');
    expect(budget.acquire('k')?.attempt).toBe(2);
  });

  it('耗尽后切换意图仍可继续（预算作用域是意图，不是全局）', () => {
    const budget = createRetryBudget({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 });
    expect(budget.acquire('a')?.attempt).toBe(1);
    expect(budget.acquire('a')).toBeNull();
    expect(budget.acquire('b')?.attempt).toBe(1);
  });

  it('耗尽后对同一意图 release 再 acquire ⇒ 重新有完整次数（槽位被作废时的自愈前提）', () => {
    const budget = createRetryBudget({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 });
    expect(budget.acquire('k')?.attempt).toBe(1);
    expect(budget.acquire('k')).toBeNull();
    budget.release('k');
    expect(budget.acquire('k')?.attempt).toBe(1);
  });
});
