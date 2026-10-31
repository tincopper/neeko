import { useEffect, useState } from 'react';

/**
 * 每 `intervalMs` 推进一次的「当前时刻」（毫秒）。
 *
 * 用途：相对时间标签（`formatRelativeTime`）是 `now` 的函数，而 React 只在 props / state
 * 变化时重渲染 —— 没有节拍的话，一个空闲会话的「刚刚」会一直挂在那里（快照不变 ⇒ 不重渲染）。
 *
 * 一个组件里只挂**一个**定时器，把 `now` 传给每一行（而不是每行各起一个 `setInterval`）。
 * `intervalMs` 变化时重挂；卸载时清理。
 */
export function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
