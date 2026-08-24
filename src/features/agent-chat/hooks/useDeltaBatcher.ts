import { useCallback, useEffect, useRef } from 'react';

/** 一个待合并的流式增量。 */
export interface PendingDelta {
  kind: 'text' | 'reasoning';
  delta: string;
}

/**
 * rAF 批处理器：把高频 text/reasoning delta 累积到 ref buffer，一个动画帧内一次性
 * flush 到 state，避免逐 token 全量 setState 导致整棵消息树重渲染
 * （对齐 MUI streamFlushInterval 思路，事件按到达顺序合并）。
 *
 * - `push(kind, delta)`：追加增量；首个 push 调度一次 rAF。
 * - `flush()`：立即 flush（供话轮边界等事件同步收尾），并取消挂起的 rAF。
 * - 卸载时自动取消挂起的 rAF。
 *
 * 回调通过 ref 保持最新，重渲染后 flush 仍使用最新闭包。
 */
export function useDeltaBatcher(onFlush: (deltas: PendingDelta[]) => void) {
  const pendingRef = useRef<PendingDelta[]>([]);
  const rafRef = useRef<number | null>(null);
  const onFlushRef = useRef(onFlush);

  // 回调保持最新（render 期间禁止写 ref，故放在 effect 中同步）
  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  const flush = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    onFlushRef.current(pending);
  }, []);

  const push = useCallback((kind: PendingDelta['kind'], delta: string) => {
    pendingRef.current.push({ kind, delta });
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        if (pending.length === 0) return;
        pendingRef.current = [];
        onFlushRef.current(pending);
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { push, flush };
}
