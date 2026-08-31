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
} from '../typography';

describe('typography tokens', () => {
  it('MONO_DEFAULT contains monospace', () => {
    expect(MONO_DEFAULT).toContain('monospace');
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

  it('writes --font-mono, --font-size and --terminal-font-size', () => {
    syncTypographyTokens({ monoFamily: 'Fira Code', uiFontSize: 12, monoFontSize: 14 });
    expect(setSpy).toHaveBeenCalledWith('--font-mono', expect.stringContaining('Fira Code'));
    expect(setSpy).toHaveBeenCalledWith('--font-size', '12px');
    expect(setSpy).toHaveBeenCalledWith('--terminal-font-size', '14px');
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
