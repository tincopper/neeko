/**
 * 异步测试夹具（非生产代码）：把「谁先完成」变成测试可以显式控制的事。
 *
 * - [`deferred`]：手动决定何时兑现的 Promise。用于构造**真实交错**——挂起一条链、
 *   让另一条链先完成，再兑现挂起的那条。「先 await 再 resolve」的写法只能测到顺序执行，
 *   测不出「迟到者覆盖」这类竞态。
 * - [`flushMicrotasks`]：冲刷微任务，让挂起的链推进到下一个 `await`。
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes pending microtasks so async chains make progress deterministically. */
export async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
