/**
 * 测试环境边界上的定时器收口。
 *
 * 问题：组件卸载与绘制调度里的副作用都排在宏任务上 —— Radix FocusScope 在卸载时用
 * `setTimeout(0)` 派发 `focusScope.autoFocusOnUnmount`，终端 / 布局用 `requestAnimationFrame`
 * 做测量与折叠。而 vitest 在**文件结束**时会销毁 jsdom 环境：全局 `Event` 还原成 Node 原生实现、
 * `document` 失效。那一刻仍在挂起的回调一旦触发就抛
 * `Failed to execute 'dispatchEvent' ... parameter 1 is not of type 'Event'` 之类的错误 ——
 * 没有任何用例失败，整轮却判红（2026-09-30 实测：同一份代码一轮红一轮绿；全仓 32 个弹层测试
 * 文件、多处 RAF 调度都有同一颗雷）。
 *
 * 做法：setup 期把调度函数包一层登记挂起项，**文件结束时统一取消**。于是"卸载副作用跨越环境
 * 边界"在构造上不可能发生 —— 不是把竞态窗口调小，而是让它不存在。
 *
 * 为什么取消而不是等一个宏任务：等待只覆盖 0ms 那一类、仍然是竞态，RAF（jsdom 下 ~16ms）与更长
 * 延时的调度都漏网；取消对所有延时都成立，也不需要付出真实等待。文件结束时已无任何用例在跑，
 * 因此取消这些回调与让它们跑在语义上等价。
 *
 * 边界（诚实的部分）：只覆盖**文件结束前**排下的调度。文件结束后（环境 teardown 期间）新排的
 * 定时器属于 harness 自己的事，这里刻意不接管 —— 若在那里也拦截，会把 vitest 自身的调度一起
 * 变成空操作，反而卡死收尾。
 *
 * `scope` 可注入是为了可测：单测传假 scope，逐条断言转发、登记、清除与取消。
 */
export interface TimerScope {
  setTimeout?: unknown;
  clearTimeout?: unknown;
  setInterval?: unknown;
  clearInterval?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
}

export interface TimerTracking {
  /** 取消本文件所有挂起项；返回被取消的数量。 */
  releaseAll(): number;
  /** 当前挂起项数量（登记是否生效可断言）。 */
  pendingCount(): number;
}

type ScheduleFn = (
  run: (...args: unknown[]) => void,
  delay?: number,
  ...args: unknown[]
) => unknown;
type ClearFn = (handle: unknown) => void;

export function installTimerTracking(scope: TimerScope = globalThis as TimerScope): TimerTracking {
  /** handle → 取消它的动作。handle 是各 scope 自己的类型（Node 是对象、jsdom 是数字），只做键用。 */
  const pending = new Map<unknown, () => void>();

  const wrapSchedule = (
    scheduleKey: 'setTimeout' | 'setInterval' | 'requestAnimationFrame',
    clearKey: 'clearTimeout' | 'clearInterval' | 'cancelAnimationFrame',
    passDelay: boolean,
  ) => {
    const schedule = scope[scheduleKey] as ScheduleFn | undefined;
    const clear = scope[clearKey] as ClearFn | undefined;
    if (typeof schedule !== 'function' || typeof clear !== 'function') return;

    const wrapped = (run: (...args: unknown[]) => void, delay?: number) => {
      const handle = schedule(
        (...fired: unknown[]) => {
          pending.delete(handle);
          run(...fired);
        },
        ...(passDelay ? [delay] : []),
      );
      pending.set(handle, () => clear(handle));
      return handle;
    };
    scope[scheduleKey] = wrapped;
  };

  // 清除也要接管：否则被 clear 掉的项会一直算在 pending 里，让 releaseAll 的计数与
  // pendingCount 变成会撒谎的指标（本仓明确反对这种指标）。
  const wrapClear = (clearKey: 'clearTimeout' | 'clearInterval' | 'cancelAnimationFrame') => {
    const clear = scope[clearKey] as ClearFn | undefined;
    if (typeof clear !== 'function') return;
    scope[clearKey] = (handle: unknown) => {
      pending.delete(handle);
      clear(handle);
    };
  };

  wrapSchedule('setTimeout', 'clearTimeout', true);
  wrapSchedule('setInterval', 'clearInterval', true);
  wrapSchedule('requestAnimationFrame', 'cancelAnimationFrame', false);

  wrapClear('clearTimeout');
  wrapClear('clearInterval');
  wrapClear('cancelAnimationFrame');

  return {
    pendingCount: () => pending.size,
    releaseAll: () => {
      const count = pending.size;
      for (const undo of [...pending.values()]) undo();
      pending.clear();
      return count;
    },
  };
}
