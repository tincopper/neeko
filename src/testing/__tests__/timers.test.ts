/**
 * 定时器收口的机制用例（注入假 scope ⇒ 确定性，不依赖真实时间）。
 *
 * 这些用例钉住的是「文件结束时挂起项一定被取消」这一不变式本身 —— 集成侧只靠"跑很多轮没红"
 * 是概率证据，机制必须能确定性地断言。
 */
import { describe, expect, it, vi } from 'vitest';

import { installTimerTracking, type TimerScope } from '../timers';

/** 假 scope：把挂起项收进 Map，只在测试显式触发时"触发"，因此不依赖真实时钟。
 *
 * 注意 `spies` 必须在 install 之前留好引用：`installTimerTracking` 会**原地替换** scope 上的
 * 调度函数，之后再从 scope 上取到的已经是 wrapper（而不是 vi.fn）。 */
function fakeScope() {
  let seq = 0;
  const timeouts = new Map<number, (...args: unknown[]) => void>();
  const intervals = new Map<number, (...args: unknown[]) => void>();
  const frames = new Map<number, (time: number) => void>();

  const scope = {
    setTimeout: vi.fn((run: (...args: unknown[]) => void) => {
      const id = ++seq;
      timeouts.set(id, run);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => timeouts.delete(id)),
    setInterval: vi.fn((run: (...args: unknown[]) => void) => {
      const id = ++seq;
      intervals.set(id, run);
      return id;
    }),
    clearInterval: vi.fn((id: number) => intervals.delete(id)),
    requestAnimationFrame: vi.fn((run: (time: number) => void) => {
      const id = ++seq;
      frames.set(id, run);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
  };

  // install 只会**重新赋值** scope 上的属性（函数本身不被改写），所以这里拷贝一份引用快照，
  // 断言就能一直对着最初的 vi.fn。
  const spies = { ...scope };

  return { scope: scope as unknown as TimerScope, spies, timeouts, intervals, frames };
}

describe('installTimerTracking', () => {
  it('转发参数与返回值，回调触发后自动出栈', () => {
    const { scope, spies, timeouts } = fakeScope();
    const tracking = installTimerTracking(scope);
    const run = vi.fn();

    const handle = (scope.setTimeout as (run: () => void, delay?: number) => number)(run, 25);

    expect(spies.setTimeout).toHaveBeenCalledWith(expect.any(Function), 25);
    expect(tracking.pendingCount()).toBe(1);

    timeouts.get(handle as number)?.();

    expect(run).toHaveBeenCalledTimes(1);
    expect(tracking.pendingCount()).toBe(0);
  });

  it('clearTimeout 之后不再计入挂起（计数是会撒谎的指标，必须跟着清除走）', () => {
    const { scope, spies } = fakeScope();
    const tracking = installTimerTracking(scope);

    const handle = (scope.setTimeout as (run: () => void) => number)(vi.fn());
    (scope.clearTimeout as (handle: number) => void)(handle as number);

    expect(spies.clearTimeout).toHaveBeenCalledWith(handle);
    expect(tracking.pendingCount()).toBe(0);
    expect(tracking.releaseAll()).toBe(0);
  });

  it('releaseAll 取消全部挂起项（含 setTimeout / setInterval / RAF）', () => {
    const { scope, spies, timeouts, intervals, frames } = fakeScope();
    const tracking = installTimerTracking(scope);

    (scope.setTimeout as (run: () => void) => number)(vi.fn());
    (scope.setInterval as (run: () => void) => number)(vi.fn());
    (scope.requestAnimationFrame as (run: () => void) => number)(vi.fn());

    expect(tracking.pendingCount()).toBe(3);
    expect(tracking.releaseAll()).toBe(3);

    // 每个挂起项都被"真正"取消：假 scope 的注册表随之清空 ⇒ 回调永远不会跑。
    expect(timeouts.size).toBe(0);
    expect(intervals.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(spies.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(tracking.pendingCount()).toBe(0);
    expect(tracking.releaseAll()).toBe(0);
  });

  it('scope 缺少某个调度函数时跳过（node 环境没有 RAF，不能因此抛错）', () => {
    const { scope } = fakeScope();
    delete (scope as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (scope as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;

    const tracking = installTimerTracking(scope);
    (scope.setTimeout as (run: () => void) => number)(vi.fn());

    expect(tracking.pendingCount()).toBe(1);
    expect(tracking.releaseAll()).toBe(1);
  });

  it('releaseAll 之后不再重复取消（幂等，收尾可能被跑两次）', () => {
    const { scope, spies } = fakeScope();
    const tracking = installTimerTracking(scope);
    (scope.setTimeout as (run: () => void) => number)(vi.fn());

    expect(tracking.releaseAll()).toBe(1);
    expect(tracking.releaseAll()).toBe(0);
    expect(spies.clearTimeout).toHaveBeenCalledTimes(1);
  });
});
