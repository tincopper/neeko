import { describe, expect, it, vi } from 'vitest';

import { MAX_IN_FLIGHT_WRITES, createDrainScheduler, runDrainLoop } from '../drainLoop';

function makeArrayBuffer(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes pending microtasks so async loops make progress deterministically. */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('runDrainLoop', () => {
  it('drains until empty and reports exhausted', async () => {
    const chunks = [makeArrayBuffer([1, 2]), makeArrayBuffer([3])];
    const written: number[] = [];
    let calls = 0;
    const result = await runDrainLoop('s-1', {
      drain: () => Promise.resolve(chunks[calls++] ?? new ArrayBuffer(0)),
      write: (chunk) => written.push(...new Uint8Array(chunk)),
      pendingWrites: () => 0,
    });
    expect(written).toEqual([1, 2, 3]);
    expect(result).toEqual({ total: 3, exhausted: true });
    expect(calls).toBe(3); // two data chunks + one empty terminator
  });

  it('stops early when in-flight writes reach the backpressure gate', async () => {
    const drain = vi.fn().mockResolvedValue(makeArrayBuffer([9]));
    const pending = MAX_IN_FLIGHT_WRITES;
    const result = await runDrainLoop('s-1', {
      drain,
      write: () => {},
      pendingWrites: () => pending,
    });
    expect(drain).not.toHaveBeenCalled();
    expect(result.exhausted).toBe(false);
  });

  it('gate check happens before each pull, resuming when pressure drops', async () => {
    let pending = 0;
    const drain = vi.fn(() => {
      // Simulate each write pushing pressure above the gate mid-loop.
      pending = MAX_IN_FLIGHT_WRITES;
      return Promise.resolve(makeArrayBuffer([1]));
    });
    const result = await runDrainLoop('s-1', {
      drain,
      write: () => {},
      pendingWrites: () => pending,
    });
    // First pull passes (pending=0), then the loop exits on the gate.
    expect(drain).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(1);
    expect(result.exhausted).toBe(false);
  });

  it('propagates drain failures to the caller', async () => {
    const drain = vi.fn().mockRejectedValue(new Error('session gone'));
    await expect(
      runDrainLoop('s-1', { drain, write: () => {}, pendingWrites: () => 0 }),
    ).rejects.toThrow('session gone');
  });
});

describe('createDrainScheduler', () => {
  it('onWake starts a loop that drains to empty', async () => {
    const chunks = [makeArrayBuffer([1]), makeArrayBuffer([2])];
    let calls = 0;
    const drain = vi.fn(() => Promise.resolve(chunks[calls++] ?? new ArrayBuffer(0)));
    const written: number[] = [];
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      write: (c) => written.push(...new Uint8Array(c)),
      pendingWrites: () => 0,
    });

    scheduler.onWake();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(3));
    expect(written).toEqual([1, 2]);
  });

  it('REGRESSION: wake arriving while draining is latched, not swallowed', async () => {
    // 冻结故障复现路径：竞态补发的 wake 落在 draining 尾窗 → 旧实现直接丢弃 →
    // 数据永久滞留。新协议必须记 pendingWake 并在循环退出后续跑。
    const first = deferred<ArrayBuffer>();
    const second = deferred<ArrayBuffer>();
    const afterLatch = [makeArrayBuffer([7, 7]), new ArrayBuffer(0)];
    let postLatchCalls = 0;
    const drain = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementation(() =>
        Promise.resolve(afterLatch[postLatchCalls++] ?? new ArrayBuffer(0)),
      );
    const written: number[] = [];
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      write: (c) => written.push(...new Uint8Array(c)),
      pendingWrites: () => 0,
    });

    scheduler.onWake(); // loop starts, parked on first.promise
    await flushMicrotasks();
    expect(drain).toHaveBeenCalledTimes(1);

    scheduler.onWake(); // arrives mid-drain → must latch, NOT be lost
    expect(drain).toHaveBeenCalledTimes(1);

    first.resolve(makeArrayBuffer([1]));
    second.resolve(new ArrayBuffer(0)); // first cycle ends "empty"
    // 续跑链路在微任务内瞬时完成：循环1(call1 first + call2 second terminator)
    // → finally 闩锁续跑 → 循环2(call3 [7,7] + call4 terminator)。直接断言终态。
    await vi.waitFor(() => expect(written).toEqual([1, 7, 7]));
    expect(drain).toHaveBeenCalledTimes(4);
  });

  it('REGRESSION: gate-exit resumes pulling once xterm digests (no permanent stall)', async () => {
    // 冻结故障主路径：门闸早退后旧实现无人续拉 → wake_in_flight 粘死 → tab 永久冻结。
    let pending = 0;
    const responses: ArrayBuffer[] = [
      makeArrayBuffer([1]),
      makeArrayBuffer([2]),
      new ArrayBuffer(0),
    ];
    let idx = 0;
    const drain = vi.fn(() => Promise.resolve(responses[idx++] ?? new ArrayBuffer(0)));
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      // 每次写入产生 6 个在途 write：两次 pull 后达到 MAX_IN_FLIGHT_WRITES=16，
      // 第三次迭代在门闸处早退 —— 模拟 xterm 消化不过来的真实场景。
      write: () => {
        pending += 6;
      },
      pendingWrites: () => pending,
    });

    scheduler.onWake();
    await flushMicrotasks();
    // Two pulls passed, then the gate broke the loop before the third pull.
    expect(drain).toHaveBeenCalledTimes(2);

    // xterm digests everything → parse callbacks fire.
    pending = 0;
    scheduler.onWriteDigested();
    await flushMicrotasks();
    // Resume must pull remaining data and reach the empty terminator.
    expect(drain).toHaveBeenCalledTimes(3);
  });

  it('onWriteDigested is a no-op without residual evidence (zero idle invokes)', async () => {
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });

    scheduler.onWriteDigested();
    scheduler.onWriteDigested();
    scheduler.onWriteDigested();
    expect(drain).not.toHaveBeenCalled();
  });

  it('drain failure is contained: no unhandled rejection, scheduler restartable', async () => {
    // 若 rejection 逃逸为 unhandledRejection，vitest 会直接判整个测试失败，
    // 因此本用例通过即证明异常被调度器内部吸收；重启能力单独断言。
    const boom = deferred<ArrayBuffer>();
    const drain = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockImplementationOnce(() => boom.promise)
      .mockImplementationOnce(() => Promise.resolve(makeArrayBuffer([5])))
      .mockResolvedValue(new ArrayBuffer(0)); // terminator — 否则协议会正确地无限续拉
    const written: number[] = [];
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      write: (c) => written.push(...new Uint8Array(c)),
      pendingWrites: () => 0,
    });

    scheduler.onWake();
    boom.reject(new Error('session gone'));
    await flushMicrotasks();

    // Restart via a fresh wake must work after the failure.
    scheduler.onWake();
    await vi.waitFor(() => expect(written).toEqual([5]));
  });

  it('latched wake during backpressured cycle keeps draining=true until quiet', async () => {
    // 连续 wake 合并：循环退出时仅续跑一轮，不因 N 个积压 wake 产生 N 轮空转。
    let pending = 0;
    let calls = 0;
    const drain = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        // First cycle: one chunk then gate-exit on next check.
        pending = MAX_IN_FLIGHT_WRITES;
        return Promise.resolve(makeArrayBuffer([1]));
      }
      return Promise.resolve(new ArrayBuffer(0));
    });
    const scheduler = createDrainScheduler({
      sessionId: 's-1',
      drain,
      write: () => {},
      pendingWrites: () => pending,
    });

    scheduler.onWake();
    scheduler.onWake();
    scheduler.onWake();
    await flushMicrotasks();
    // Cycle 1 ended at gate with three wakes seen → ONE latch-retry cycle runs,
    // which breaks at the gate check WITHOUT issuing another invoke (pending
    // is still maxed) — zero idle invokes is exactly the desired behavior.
    expect(drain).toHaveBeenCalledTimes(1);
  });
});
