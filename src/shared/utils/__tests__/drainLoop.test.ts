import { describe, expect, it, vi } from 'vitest';

import {
  DRAIN_POLL_INTERVAL_MS,
  MAX_IN_FLIGHT_WRITES,
  createDrainScheduler,
  createDrainTransportScheduler,
  createLongPollScheduler,
  createPollingDrainScheduler,
  runDrainLoop,
} from '../drainLoop';

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

describe('createPollingDrainScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pulls on the shared poll interval', async () => {
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createPollingDrainScheduler({
      sessionId: 'poll-1',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS);
    expect(drain).toHaveBeenCalledWith('poll-1');
    scheduler.dispose();
  });

  it('stops pulling after dispose (idempotent)', async () => {
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createPollingDrainScheduler({
      sessionId: 'poll-2',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });
    scheduler.dispose();
    scheduler.dispose(); // 二次注销应安全
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS * 3);
    expect(drain).not.toHaveBeenCalled();
  });

  it('drains until empty inside one tick (bytes never lost)', async () => {
    const drain = vi
      .fn()
      .mockResolvedValueOnce(makeArrayBuffer([1, 2, 3]))
      .mockResolvedValueOnce(makeArrayBuffer([4]))
      .mockResolvedValue(new ArrayBuffer(0));
    const write = vi.fn();
    const scheduler = createPollingDrainScheduler({
      sessionId: 'poll-3',
      drain,
      write,
      pendingWrites: () => 0,
    });
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS);
    // 同一 tick 内连续拉取：2 块数据 + 1 次空探针
    expect(drain).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('idle sessions cost one empty probe per tick', async () => {
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createPollingDrainScheduler({
      sessionId: 'poll-4',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS * 2);
    expect(drain).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});

describe('createPollingDrainScheduler — sessionId 冲突/重复注册', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('旧实例 dispose 不影响同 sessionId 的新实例（重建竞态安全）', async () => {
    // 场景：同 sessionId 先后注册 A（旧）→ B（新），随后旧 A.dispose()。
    // 若注册表是「key→单回调」，A.dispose 会误删 B 的条目 → B 永久停摆。
    const drainA = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const drainB = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const schedulerA = createPollingDrainScheduler({
      sessionId: 'same-id',
      drain: drainA,
      write: () => {},
      pendingWrites: () => 0,
    });
    const schedulerB = createPollingDrainScheduler({
      sessionId: 'same-id',
      drain: drainB,
      write: () => {},
      pendingWrites: () => 0,
    });

    schedulerA.dispose(); // 旧实例先注销 —— 不得波及 B
    schedulerA.dispose(); // 幂等：二次注销安全

    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS * 2);
    expect(drainB).toHaveBeenCalledTimes(2); // B 仍在轮询
    expect(drainA).toHaveBeenCalledTimes(0); // A 已停
    schedulerB.dispose();
  });

  it('全部注销后共享轮询器停止空转', async () => {
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createPollingDrainScheduler({
      sessionId: 'stop-id',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS);
    expect(drain).toHaveBeenCalledTimes(1);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS * 3);
    expect(drain).toHaveBeenCalledTimes(1); // 不再空转
  });
});

describe('createDrainTransportScheduler', () => {
  const POLL_ENV = 'VITE_TERMINAL_DRAIN_POLL';
  const original = process.env[POLL_ENV];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) {
      delete process.env[POLL_ENV];
    } else {
      process.env[POLL_ENV] = original;
    }
  });

  it('VITE_TERMINAL_DRAIN_POLL=1 falls back to polling', async () => {
    process.env[POLL_ENV] = '1';
    const drain = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const scheduler = createDrainTransportScheduler({
      sessionId: 'sel-1',
      drain,
      write: () => {},
      pendingWrites: () => 0,
    });
    await vi.advanceTimersByTimeAsync(DRAIN_POLL_INTERVAL_MS);
    expect(drain).toHaveBeenCalledWith('sel-1');
    scheduler.dispose();
  });

  it('defaults to long-poll when flag unset', async () => {
    delete process.env[POLL_ENV];
    const drainWait = vi.fn().mockImplementation(() => new Promise(() => {}));
    const scheduler = createDrainTransportScheduler({
      sessionId: 'sel-2',
      drain: vi.fn(),
      drainWait,
      write: () => {},
      pendingWrites: () => 0,
    });
    await flushMicrotasks(10);
    expect(drainWait).toHaveBeenCalled();
    scheduler.dispose();
  });
});

describe('createLongPollScheduler', () => {
  it('writes chunk then re-arms wait', async () => {
    const drainWait = vi
      .fn()
      .mockResolvedValueOnce(makeArrayBuffer([1, 2]))
      .mockImplementationOnce(() => new Promise(() => {}));
    const write = vi.fn();
    const scheduler = createLongPollScheduler({
      sessionId: 'lp-1',
      drain: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      drainWait,
      write,
      pendingWrites: () => 0,
    });
    await flushMicrotasks(20);
    expect(write).toHaveBeenCalledTimes(1);
    expect(drainWait).toHaveBeenCalledTimes(2);
    expect(drainWait).toHaveBeenNthCalledWith(1, 'lp-1', expect.any(Number));
    scheduler.dispose();
  });

  it('stops loop on NotFound error', async () => {
    const err = new Error('Terminal drain queue not found: lp-2');
    const drainWait = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockImplementation(() => new Promise(() => {}));
    const write = vi.fn();
    const scheduler = createLongPollScheduler({
      sessionId: 'lp-2',
      drain: vi.fn(),
      drainWait,
      write,
      pendingWrites: () => 0,
    });
    await flushMicrotasks(20);
    expect(drainWait).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('dispose stops loop and drops late results', async () => {
    const gate = deferred<ArrayBuffer>();
    const drainWait = vi.fn().mockReturnValueOnce(gate.promise);
    const write = vi.fn();
    const scheduler = createLongPollScheduler({
      sessionId: 'lp-3',
      drain: vi.fn(),
      drainWait,
      write,
      pendingWrites: () => 0,
    });
    await flushMicrotasks(5);
    scheduler.dispose();
    gate.resolve(makeArrayBuffer([9]));
    await flushMicrotasks(10);
    expect(write).not.toHaveBeenCalled();
    expect(drainWait).toHaveBeenCalledTimes(1);
  });

  it('backpressure gate resumes via onWriteDigested', async () => {
    let pending = MAX_IN_FLIGHT_WRITES;
    const drainWait = vi.fn().mockResolvedValue(makeArrayBuffer([7]));
    const drain = vi
      .fn()
      .mockResolvedValueOnce(makeArrayBuffer([8]))
      .mockResolvedValue(new ArrayBuffer(0));
    const write = vi.fn();
    const scheduler = createLongPollScheduler({
      sessionId: 'lp-4',
      drain,
      drainWait,
      write,
      pendingWrites: () => pending,
    });
    await flushMicrotasks(20);
    // 门闸满：long-poll 首块被 write，但 inner 续拉因门闸早退置 maybePending。
    pending = 0;
    scheduler.onWriteDigested();
    await flushMicrotasks(20);
    expect(drain).toHaveBeenCalled();
    scheduler.dispose();
  });
});
