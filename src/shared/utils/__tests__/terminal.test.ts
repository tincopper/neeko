import { describe, it, expect } from 'vitest';
import { buildFontFamily, DEFAULT_FONT_FAMILY } from '../../utils/terminal';

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
