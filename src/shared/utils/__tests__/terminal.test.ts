import { afterEach, describe, it, expect, vi } from 'vitest';

import { buildFontFamily, buildTerminalTheme, DEFAULT_FONT_FAMILY } from '../../utils/terminal';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('buildFontFamily', () => {
  it('返回包含 monospace 和 Nerd Font fallback 的默认字体族', () => {
    expect(DEFAULT_FONT_FAMILY).toContain('monospace');
  });

  it('没有自定义字体时返回默认字体链 + Nerd Font fallback', () => {
    const result = buildFontFamily('');
    expect(result).toContain('monospace');
    expect(result).toContain('NerdFontSymbols');
    expect(result).toMatch(/NerdFontSymbols'$/);
  });

  it('有自定义字体时在前面添加，末尾仍有 Nerd Font fallback', () => {
    const result = buildFontFamily('Fira Code');
    expect(result).toMatch(/^'Fira Code'/);
    expect(result).toContain('monospace');
    expect(result).toContain('NerdFontSymbols');
  });
});

describe('buildTerminalTheme', () => {
  /** 让 cssVar() 从 `vars` 中取色，未命中返回空串（触发 fallback 分支）。 */
  function stubCssVars(vars: Record<string, string>) {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        getPropertyValue: (name: string) => vars[name] ?? '',
      })),
    );
  }

  it('深色主题下滚动条 slider 使用 --bg-hover / --text-muted 主题色', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    stubCssVars({
      '--bg-secondary': '#1f1f1f',
      '--bg-hover': '#3e4451',
      '--text-muted': '#5c6370',
      '--accent-blue': '#61afef',
      '--terminal-selection': '#333333',
    });

    const theme = buildTerminalTheme();

    expect(theme.scrollbarSliderBackground).toBe('#3e4451');
    expect(theme.scrollbarSliderHoverBackground).toBe('#5c6370');
    expect(theme.scrollbarSliderActiveBackground).toBe('#5c6370');
    // 与 base.css 全局滚动条使用同一 token 源（--bg-hover thumb / --text-muted hover）
    expect(theme.background).toBe('#1f1f1f');
  });

  it('CSS 变量缺失时滚动条颜色回退到深/浅主题默认色', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    stubCssVars({});

    const darkTheme = buildTerminalTheme();
    expect(darkTheme.scrollbarSliderBackground).toBe('#3e4451');
    expect(darkTheme.scrollbarSliderHoverBackground).toBe('#5c6370');

    document.documentElement.setAttribute('data-theme', 'light');
    stubCssVars({});

    const lightTheme = buildTerminalTheme();
    expect(lightTheme.scrollbarSliderBackground).toBe('#c9cdd4');
    expect(lightTheme.scrollbarSliderHoverBackground).toBe('#9a9ea5');
  });

  it('写入 --terminal-* CSS 变量供 Debug Console 等面板同步', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    stubCssVars({ '--bg-secondary': '#101010' });

    buildTerminalTheme();

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--terminal-bg')).toBe('#101010');
    expect(style.getPropertyValue('--terminal-fg')).not.toBe('');
  });
});
