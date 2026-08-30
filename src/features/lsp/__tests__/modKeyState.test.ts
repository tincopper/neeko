import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 平台常量静态 mock：jsdom navigator.platform 非 macOS，无法覆盖真实分支；
// Meta 分支（macOS）在此覆盖，Control 分支为同构单行逻辑。
vi.mock('@/shared/utils/platform', () => ({ IS_MACOS: true }));

import { initModKeyTracking, isModKeyHeld } from '../modKeyState';

describe('modKeyState — Cmd/Ctrl 按住状态（模块级单例）', () => {
  beforeEach(() => {
    initModKeyTracking();
  });

  afterEach(() => {
    // 复位按键状态，避免跨用例污染
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  });

  it('初始为未按住', () => {
    expect(isModKeyHeld()).toBe(false);
  });

  it('macOS Meta 按下 → held', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(true);
  });

  it('松开 → 复位', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(false);
  });

  it('窗口失焦 → 复位（防按键状态卡死）', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(isModKeyHeld()).toBe(false);
  });

  it('非修饰键不影响状态', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(isModKeyHeld()).toBe(false);
  });

  it('initModKeyTracking 幂等（重复调用不叠加监听）', () => {
    initModKeyTracking();
    initModKeyTracking();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    expect(isModKeyHeld()).toBe(false);
  });
});
