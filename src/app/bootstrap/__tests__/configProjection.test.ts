import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearCustomCssVars: vi.fn(),
  applyCustomCssVars: vi.fn(),
  syncAgentTheme: vi.fn(() => Promise.resolve()),
  updateAllTerminalThemes: vi.fn(),
  syncTypographyTokens: vi.fn(),
}));

vi.mock('@/features/settings/api/appConfigNormalize', () => ({
  isBuiltinTheme: (theme: string) =>
    ['dark', 'light', 'classic-dark', 'one-dark-pro', 'claude'].includes(theme),
}));
vi.mock('../customThemeVars', () => ({
  clearCustomCssVars: mocks.clearCustomCssVars,
  applyCustomCssVars: mocks.applyCustomCssVars,
}));
vi.mock('@/features/settings/api/settingsApi', () => ({ syncAgentTheme: mocks.syncAgentTheme }));
vi.mock('@/features/terminal', () => ({ updateAllTerminalThemes: mocks.updateAllTerminalThemes }));
vi.mock('@/shared/utils/typography', () => ({ syncTypographyTokens: mocks.syncTypographyTokens }));
vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { getState: () => ({ projects: [] }) },
}));
vi.mock('@/shared/store/connectionStore', () => ({
  useConnectionStore: { getState: () => ({ wslEntries: [] }) },
}));

import { applyThemeHintBeforeRender, projectTheme, projectTypography } from '../configProjection';
import { readThemeHint } from '../themeHint';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('configProjection — 唯一投影点', () => {
  it('无 hint 时首帧不写 data-theme（沿用 CSS 兜底）', () => {
    const spy = vi.spyOn(document.documentElement, 'setAttribute');
    applyThemeHintBeforeRender();
    expect(spy).not.toHaveBeenCalledWith('data-theme', expect.anything());
    spy.mockRestore();
  });

  it('有内置主题 hint 时首帧即写入正确主题', () => {
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'light', customThemeVariables: null }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('自定义主题 hint 同时恢复 CSS 变量', () => {
    const vars = { 'bg-primary': '#123456' };
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'my-theme', customThemeVariables: vars }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBe('my-theme');
    expect(mocks.applyCustomCssVars).toHaveBeenCalledWith(vars);
  });

  it('自定义主题 hint 缺变量时不写 data-theme（绝不写半套主题）', () => {
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'my-theme', customThemeVariables: null }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(mocks.applyCustomCssVars).not.toHaveBeenCalled();
  });

  it('projectTheme 写主题 + 清理旧自定义变量 + 回写 hint', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(projectTheme({ theme: 'light', customThemeVariables: null })).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(mocks.clearCustomCssVars).toHaveBeenCalled();
    expect(readThemeHint()).toEqual({ theme: 'light', customThemeVariables: null });
  });

  it('projectTheme 对自定义主题应用变量并缓存变量表', () => {
    const vars = { 'bg-primary': '#abcdef' };
    expect(projectTheme({ theme: 'my-theme', customThemeVariables: vars })).toBe(true);
    expect(mocks.applyCustomCssVars).toHaveBeenCalledWith(vars);
    expect(readThemeHint()).toEqual({ theme: 'my-theme', customThemeVariables: vars });
  });

  it('自定义主题缺变量时整体跳过：不写 DOM、不写 hint、返回 false', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'light', customThemeVariables: null }),
    );

    expect(projectTheme({ theme: 'my-theme', customThemeVariables: null })).toBe(false);

    // DOM 与缓存都保留上一帧（light）：写半套主题会让下次冷启动首帧错色
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(mocks.applyCustomCssVars).not.toHaveBeenCalled();
    expect(readThemeHint()).toEqual({ theme: 'light', customThemeVariables: null });
  });

  it('projectTypography 只把字体字段交给唯一 token 写入口', () => {
    projectTypography({ monoFamily: 'Fira Code', uiFontSize: 13, monoFontSize: 15 });
    expect(mocks.syncTypographyTokens).toHaveBeenCalledWith({
      monoFamily: 'Fira Code',
      uiFontSize: 13,
      monoFontSize: 15,
    });
  });
});
