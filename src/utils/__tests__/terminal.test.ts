import { describe, it, expect } from 'vitest';
import { buildFontFamily, DEFAULT_FONT_FAMILY } from '../../utils/terminal';

describe('buildFontFamily', () => {
  it('返回包含 monospace 的默认字体族', () => {
    expect(DEFAULT_FONT_FAMILY).toContain('monospace');
  });

  it('没有自定义字体时返回默认 monospace', () => {
    const result = buildFontFamily('');
    expect(result).toContain('monospace');
    expect(result).toBe(DEFAULT_FONT_FAMILY);
  });

  it('有自定义字体时在前面添加', () => {
    const result = buildFontFamily('Fira Code');
    expect(result).toMatch(/^'Fira Code'/);
    expect(result).toContain('monospace');
  });
});
