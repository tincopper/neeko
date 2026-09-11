/** 浮层进入 / 退出动画原语（`usePresence` + 挂载门控 + 减动偏好）。
 *
 * 抽自 `LspStatusSection`：与具体业务无关，任何 portal / 下拉 / 展开面板可复用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Enter/exit presence: mounts the element, animates opacity+transform, and only
 * unmounts after the exit transition finishes. Returns the inline style that
 * drives the animation plus an onTransitionEnd handler.
 */
export function usePresence(visible: boolean, onExited?: () => void) {
  const [mounted, setMounted] = useState(visible);
  const [show, setShow] = useState(visible);
  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useEffect(() => {
    if (visible) {
      // Sync mount + next-frame show: the element must be in the DOM before
      // toggling the transform/opacity so the enter transition plays.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      const id = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(id);
    }
    setShow(false);
    return undefined;
  }, [visible]);

  const onTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false);
      onExitedRef.current?.();
    }
  }, [visible]);

  return { mounted, show, onTransitionEnd };
}

/** Returns true one frame after mount — used to delay position transitions. */
export function useOnlyAfterMount() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/** Respects the user's reduced-motion preference. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
