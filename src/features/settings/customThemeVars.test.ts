/**
 * 自定义主题 CSS 变量应用/清理的直测（从 useAppConfig 抽出的纯副作用模块）。
 *
 * 契约：应用新主题前必须清理上一次应用的键，否则未覆盖的旧变量会残留。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { applyCustomCssVars, clearCustomCssVars } from '@/features/settings/customThemeVars';

describe('customThemeVars', () => {
  afterEach(() => {
    clearCustomCssVars();
    document.documentElement.removeAttribute('style');
  });

  it('应用已知变量，未在白名单内的键被忽略', () => {
    applyCustomCssVars({ 'bg-primary': '#111111', 'not-a-known-var': '#ffffff' });
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#111111');
    expect(document.documentElement.style.getPropertyValue('--not-a-known-var')).toBe('');
  });

  it('应用新主题前清理上一次应用的键（未覆盖的旧变量不残留）', () => {
    applyCustomCssVars({ 'bg-primary': '#111111', 'text-primary': '#eeeeee' });
    applyCustomCssVars({ 'bg-secondary': '#222222' });
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bg-secondary')).toBe('#222222');
  });

  it('clearCustomCssVars 清理当前应用的变量', () => {
    applyCustomCssVars({ 'bg-primary': '#111111' });
    clearCustomCssVars();
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('');
  });
});
