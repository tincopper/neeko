import { IS_MACOS } from '@/shared/utils/platform';

/**
 * 模块级 Cmd/Ctrl 按住状态（macOS → Meta，其他 → Control）。
 *
 * hover docs 与「按住 Cmd 点击跳转」是天然竞争关系：Cmd 按住时 hover
 * tooltip 会挡住点击目标。此状态被两类消费方共享：
 * - `useCmdHeld`（React 侧光标反馈）
 * - `lspHoverExtension`（Cmd 按住时抑制 hover docs，VSCode 同款行为）
 *
 * 模块被 import 即完成监听注册（幂等），无初始化顺序依赖。
 */

let modHeld = false;
let initialized = false;

/** @internal test hook — resets held state between tests. */
export function __resetModKeyStateForTests(): void {
  modHeld = false;
}

function isModKey(key: string): boolean {
  return key === (IS_MACOS ? 'Meta' : 'Control');
}

/** Track modifier key state. Idempotent: repeated calls register only once. */
export function initModKeyTracking(): void {
  if (initialized) return;
  initialized = true;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isModKey(e.key)) modHeld = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (isModKey(e.key)) modHeld = false;
  };
  const onBlur = () => {
    modHeld = false;
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
}

/** Whether the jump modifier (Cmd on macOS / Ctrl elsewhere) is held down. */
export function isModKeyHeld(): boolean {
  return modHeld;
}

// Import 即监听：消费方（hook / CM 扩展）无需感知初始化顺序
initModKeyTracking();
