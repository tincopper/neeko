import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import {
  MONO_DEFAULT,
  MONO_LINE_HEIGHT,
  SANS_DEFAULT,
  TERMINAL_FONT_WEIGHT,
  buildMonoStack,
  buildSansStack,
  ensureTerminalFontsReady,
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

describe('resolveTerminalLineHeight — flat 1.0（对齐 orca）', () => {
  it('任意字号恒为 1（cell 高 = 字号，dpr 2 时 14px → 28 device px 整数）', () => {
    for (let size = 10; size <= 24; size++) {
      expect(resolveTerminalLineHeight(size)).toBe(1);
    }
  });
});

describe('TERMINAL_FONT_WEIGHT — 终端默认字重', () => {
  it('为 300（Light），对齐 orca 观感基准', () => {
    expect(TERMINAL_FONT_WEIGHT).toBe(300);
  });
});

describe('ensureTerminalFontsReady — P0-A 字体门闩', () => {
  type FontsStub = {
    check: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    forEach: ReturnType<typeof vi.fn>;
  };
  let fontsStub: FontsStub | undefined;

  /** jsdom 缺 document.fonts：defineProperty 注入可控假体。 */
  function stubFonts(impl: { checkResult?: boolean; webFont?: boolean }) {
    fontsStub = {
      check: vi.fn(() => impl.checkResult ?? false),
      load: vi.fn(() => Promise.resolve([])),
      forEach: vi.fn((cb: (ff: { family: string }) => void) => {
        if (impl.webFont) cb({ family: '"JetBrains Mono"' });
      }),
    };
    Object.defineProperty(document, 'fonts', { value: fontsStub, configurable: true });
  }

  afterEach(() => {
    // 还原 document.fonts 缺失态，避免污染其它用例/套件
    delete (document as unknown as { fonts?: unknown }).fonts;
    fontsStub = undefined;
  });

  it('无 document.fonts（node/jsdom 缺失）→ 立即 resolve 不抛', async () => {
    await expect(ensureTerminalFontsReady(MONO_DEFAULT, 14)).resolves.toBeUndefined();
  });

  it('系统字体（check 通过）→ 零延迟放行、不触发 load', async () => {
    stubFonts({ checkResult: true });
    await expect(ensureTerminalFontsReady(MONO_DEFAULT, 14)).resolves.toBeUndefined();
    expect(fontsStub!.load).not.toHaveBeenCalled();
  });

  it('未注册 @font-face（用户配置了不存在的字体）→ 零延迟放行、不触发 load', async () => {
    stubFonts({ checkResult: false, webFont: false });
    await expect(ensureTerminalFontsReady(MONO_DEFAULT, 14)).resolves.toBeUndefined();
    expect(fontsStub!.load).not.toHaveBeenCalled();
  });

  it('打包字体加载中 → 等终端字重(300) + bold 两档 load 完成才放行', async () => {
    stubFonts({ checkResult: false, webFont: true });
    const releases: Array<() => void> = [];
    fontsStub!.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve as () => void);
        }),
    );

    const gate = ensureTerminalFontsReady(MONO_DEFAULT, 14, 5000);
    // 两档（300 + bold）都发起加载后才 resolve
    expect(fontsStub!.load).toHaveBeenCalledTimes(2);
    expect(fontsStub!.load).toHaveBeenNthCalledWith(
      1,
      '300 14px "JetBrains Mono"',
      expect.stringContaining('A'),
    );
    releases.forEach((r) => r());
    await expect(gate).resolves.toBeUndefined();
  });

  it('load 挂起超过超时 → 静默放行（兜底不阻塞终端创建）', async () => {
    stubFonts({ checkResult: false, webFont: true });
    fontsStub!.load.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    await expect(ensureTerminalFontsReady(MONO_DEFAULT, 14, 20)).resolves.toBeUndefined();
  });

  it('load reject（字体源失败）→ 静默放行不抛', async () => {
    stubFonts({ checkResult: false, webFont: true });
    fontsStub!.load.mockImplementation(() => Promise.reject(new Error('font source failed')));
    await expect(ensureTerminalFontsReady(MONO_DEFAULT, 14, 5000)).resolves.toBeUndefined();
  });
});
