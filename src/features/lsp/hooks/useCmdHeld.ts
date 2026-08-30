import { useEffect, useState } from 'react';

import { initModKeyTracking, isModKeyHeld } from '../modKeyState';

/**
 * Tracks whether the modifier key for Cmd+Click (Cmd on macOS, Ctrl on other
 * platforms) is currently held down. Returns true while the key is pressed.
 *
 * Used to provide visual feedback (pointer cursor) before the user clicks.
 *
 * 状态源收敛在模块级 `modKeyState`（与 hover docs 抑制共享同一事实源），
 * 本 hook 只负责把模块状态桥接为 React 渲染状态。
 */
export function useCmdHeld(): boolean {
  const [held, setHeld] = useState(isModKeyHeld);

  useEffect(() => {
    initModKeyTracking();
    const sync = () => setHeld(isModKeyHeld());
    // 任意按键都可能改变修饰键状态；模块层已做键过滤，这里以轻量轮询事件桥接
    document.addEventListener('keydown', sync);
    document.addEventListener('keyup', sync);
    window.addEventListener('blur', sync);

    return () => {
      document.removeEventListener('keydown', sync);
      document.removeEventListener('keyup', sync);
      window.removeEventListener('blur', sync);
    };
  }, []);

  return held;
}
