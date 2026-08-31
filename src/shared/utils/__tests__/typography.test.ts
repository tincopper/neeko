import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import {
  MONO_DEFAULT,
  MONO_LINE_HEIGHT,
  SANS_DEFAULT,
  buildMonoStack,
  buildSansStack,
  resolveEditorFontSize,
  resolveEffectiveSizes,
  resolveTerminalFontSize,
  syncTypographyTokens,
  resolveTerminalLineHeight,
} from '../typography';

describe('typography tokens', () => {
  it('MONO_DEFAULT contains monospace', () => {
    expect(MONO_DEFAULT).toContain('monospace');
  });

  it('MONO_DEFAULT leads with bundled JetBrains Mono and ends with Menlo fallback', () => {
    // 打包字体首位：不依赖系统安装（杜绝同屏双字体的 fallback 漂移）
    expect(MONO_DEFAULT.indexOf("'JetBrains Mono'")).toBe(0);
    // macOS 确定存在的字体兜底
    expect(MONO_DEFAULT).toContain('Menlo');
  });

  it('SANS_DEFAULT contains sans-serif', () => {
    expect(SANS_DEFAULT).toContain('sans-serif');
  });

  it('buildMonoStack with empty returns MONO_DEFAULT + Nerd fallback', () => {
    const result = buildMonoStack('');
    expect(result).toContain(MONO_DEFAULT);
    expect(result).toContain('NerdFontSymbols');
    expect(result).toMatch(/NerdFontSymbols'$/);
  });

  it('buildMonoStack with custom font prefixes user font', () => {
    const result = buildMonoStack('Fira Code');
    expect(result).toMatch(/^'Fira Code'/);
    expect(result).toContain('monospace');
    expect(result).toContain('NerdFontSymbols');
  });

  it('buildSansStack with empty returns SANS_DEFAULT', () => {
    expect(buildSansStack('')).toBe(SANS_DEFAULT);
  });

  it('buildSansStack with custom font prefixes user font', () => {
    const result = buildSansStack('Inter');
    expect(result).toMatch(/^'Inter'/);
    expect(result).toContain('sans-serif');
  });
});

describe('syncTypographyTokens', () => {
  let setSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setSpy = vi.fn();
    vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(setSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes --font-size and --terminal-font-size', () => {
    syncTypographyTokens({ monoFamily: 'Fira Code', uiFontSize: 12, monoFontSize: 14 });
    expect(setSpy).toHaveBeenCalledWith('--font-size', '12px');
    expect(setSpy).toHaveBeenCalledWith('--terminal-font-size', '14px');
  });

  it('terminal font must NOT leak into global --font-mono (app mono role is independent)', () => {
    // 终端字体与 UI 等宽角色分离：改终端字体不允许改变应用内的 font-mono 消费
    syncTypographyTokens({ monoFamily: 'Comic Sans MS', uiFontSize: 12, monoFontSize: 14 });
    const monoCall = setSpy.mock.calls.find(([k]) => k === '--font-mono');
    expect(monoCall?.[1]).not.toContain('Comic Sans MS');
  });

  it('still writes --font-mono as the app default mono stack', () => {
    syncTypographyTokens({ monoFamily: '', uiFontSize: 12, monoFontSize: 14 });
    expect(setSpy).toHaveBeenCalledWith('--font-mono', expect.stringContaining('JetBrains Mono'));
  });

  it('writes --line-height-mono when provided', () => {
    syncTypographyTokens({ monoFamily: '', uiFontSize: 12, monoFontSize: 14, monoLineHeight: 1.5 });
    expect(setSpy).toHaveBeenCalledWith('--line-height-mono', '1.5');
  });

  it('does not write --line-height-mono when undefined', () => {
    syncTypographyTokens({ monoFamily: '', uiFontSize: 12, monoFontSize: 14 });
    const calls = setSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('--line-height-mono');
  });

  it('uses MONO_DEFAULT when monoFamily is empty', () => {
    syncTypographyTokens({ monoFamily: '', uiFontSize: 12, monoFontSize: 14 });
    const monoCall = setSpy.mock.calls.find((c: unknown[]) => c[0] === '--font-mono');
    expect(monoCall?.[1]).toContain('monospace');
    expect(monoCall?.[1]).toContain('NerdFontSymbols');
  });
});

describe('font size harmony', () => {
  it('MONO_LINE_HEIGHT is 1.5', () => {
    expect(MONO_LINE_HEIGHT).toBe(1.5);
  });

  it('resolveTerminalFontSize default = ui + 2', () => {
    expect(resolveTerminalFontSize(12, null)).toBe(14);
    expect(resolveTerminalFontSize(12, undefined)).toBe(14);
    expect(resolveTerminalFontSize(10, null)).toBe(12);
    expect(resolveTerminalFontSize(13, null)).toBe(15);
  });

  it('resolveTerminalFontSize returns valid terminal when provided', () => {
    expect(resolveTerminalFontSize(12, 16)).toBe(16);
    expect(resolveTerminalFontSize(12, 10)).toBe(10);
    expect(resolveTerminalFontSize(12, 24)).toBe(24);
  });

  it('resolveTerminalFontSize falls back for illegal terminal values', () => {
    expect(resolveTerminalFontSize(12, NaN as unknown as number)).toBe(14);
    // @ts-expect-error illegal type
    expect(resolveTerminalFontSize(12, '14')).toBe(14);
    expect(resolveTerminalFontSize(12, 9)).toBe(14); // below min
    expect(resolveTerminalFontSize(12, 30)).toBe(14); // above max
    expect(resolveTerminalFontSize(12, null)).toBe(14);
  });

  it('resolveEditorFontSize default = terminal', () => {
    expect(resolveEditorFontSize(14, null)).toBe(14);
    expect(resolveEditorFontSize(14, undefined)).toBe(14);
    expect(resolveEditorFontSize(16, null)).toBe(16);
  });

  it('resolveEditorFontSize returns editor when valid', () => {
    expect(resolveEditorFontSize(14, 12)).toBe(12);
    expect(resolveEditorFontSize(14, 16)).toBe(16);
  });

  it('resolveEditorFontSize falls back for illegal editor', () => {
    expect(resolveEditorFontSize(14, NaN as unknown as number)).toBe(14);
    // @ts-expect-error illegal
    expect(resolveEditorFontSize(14, '12')).toBe(14);
    expect(resolveEditorFontSize(14, 9)).toBe(14);
  });

  it('resolveEffectiveSizes composes terminal + editor', () => {
    expect(resolveEffectiveSizes(12, null, null)).toEqual({ terminal: 14, editor: 14 });
    expect(resolveEffectiveSizes(12, 16, null)).toEqual({ terminal: 16, editor: 16 });
    expect(resolveEffectiveSizes(12, 16, 13)).toEqual({ terminal: 16, editor: 13 });
    expect(resolveEffectiveSizes(12, null, 18)).toEqual({ terminal: 14, editor: 18 });
  });

  it('resolveEffectiveSizes clamps ui+2 within bounds', () => {
    expect(resolveEffectiveSizes(24, null, null).terminal).toBe(24); // clamped 26→24
    expect(resolveEffectiveSizes(10, null, null).terminal).toBe(12);
  });
});

describe('resolveTerminalLineHeight — 行高随字号缩放', () => {
  it('默认 14px 附近维持 1.2（既有观感不回归）', () => {
    expect(resolveTerminalLineHeight(14)).toBe(1.2);
  });

  it('小字号提高倍率（避免行距占比过大显得松散）', () => {
    expect(resolveTerminalLineHeight(10)).toBeGreaterThan(1.2);
    expect(resolveTerminalLineHeight(12)).toBeGreaterThan(1.2);
  });

  it('大字号降低倍率（避免行距绝对值过大）', () => {
    expect(resolveTerminalLineHeight(20)).toBeLessThan(1.2);
    expect(resolveTerminalLineHeight(24)).toBeLessThan(resolveTerminalLineHeight(20));
  });

  it('倍率单调递减（字号越大倍率越小，无跳变）', () => {
    let prev = Infinity;
    for (let size = 10; size <= 24; size++) {
      const lh = resolveTerminalLineHeight(size);
      expect(lh).toBeLessThanOrEqual(prev);
      expect(lh).toBeGreaterThan(0);
      prev = lh;
    }
  });

  it('像素行距不小于可读下限（cell 高度 = size × lineHeight ≥ 1.15 × 基准）', () => {
    // 倍率递减但像素间距不能塌：10px 字号时 cell 高度不得低于 12px 附近观感
    for (let size = 10; size <= 24; size++) {
      const cellPx = size * resolveTerminalLineHeight(size);
      expect(cellPx).toBeGreaterThanOrEqual(13); // ≈ 14px × 0.93 的可读下限
    }
  });
});
