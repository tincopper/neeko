import { beforeEach, describe, expect, it } from 'vitest';

import { readThemeHint, writeThemeHint } from '../themeHint';

const KEY = 'neeko.theme-hint';

describe('themeHint — 首帧前的同步主题缓存', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('写入后可读回同一份 hint', () => {
    writeThemeHint({ theme: 'light', customThemeVariables: null });
    expect(readThemeHint()).toEqual({ theme: 'light', customThemeVariables: null });
  });

  it('自定义主题变量随 hint 一起持久化', () => {
    writeThemeHint({ theme: 'my-theme', customThemeVariables: { 'bg-primary': '#123456' } });
    expect(readThemeHint()).toEqual({
      theme: 'my-theme',
      customThemeVariables: { 'bg-primary': '#123456' },
    });
  });

  it('缓存为空时返回 null（首次启动沿用 CSS 兜底）', () => {
    expect(readThemeHint()).toBeNull();
  });

  it('脏数据/结构非法时返回 null 而不抛错', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readThemeHint()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ theme: 42 }));
    expect(readThemeHint()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ theme: 'light', customThemeVariables: 'oops' }));
    expect(readThemeHint()).toBeNull();
  });

  it('变量表里的非字符串项被过滤', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ theme: 'custom', customThemeVariables: { ok: '#fff', bad: 3 } }),
    );
    expect(readThemeHint()).toEqual({
      theme: 'custom',
      customThemeVariables: { ok: '#fff' },
    });
  });
});
