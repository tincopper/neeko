import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../stripAnsi';

describe('stripAnsi', () => {
  it('should_strip_sgr_color_and_reset', () => {
    expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok');
  });

  it('should_strip_charset_select_like_codelldb_garbage', () => {
    // codelldb 实测乱码：`[32mok(B[m` → 剥 SGR + `(B` 字符集
    expect(stripAnsi('\x1b[32mok\x1b(B\x1b[m')).toBe('ok');
  });

  it('should_strip_osc_hyperlinks', () => {
    expect(stripAnsi('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
  });

  it('should_keep_plain_text_untouched', () => {
    expect(stripAnsi('plain text 123')).toBe('plain text 123');
  });

  it('should_strip_multiline_mixed_output', () => {
    const input = 'line1\x1b[32m green\x1b[0m\nline2 \x1b(B\x1b[31mred\x1b[0m';
    expect(stripAnsi(input)).toBe('line1 green\nline2 red');
  });
});
