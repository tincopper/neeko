import { describe, expect, it } from 'vitest';

import { isCodelldbNoise } from '../utils/consoleFilter';

describe('isCodelldbNoise', () => {
  it('命中 codelldb 三类提示噪音前缀', () => {
    expect(
      isCodelldbNoise("Console is in 'commands' mode (type .help for a list of commands)"),
    ).toBe(true);
    expect(
      isCodelldbNoise(
        'Loading Rust formatters from /Users/demo/.vscode/extensions/vadimcn.vscode-lldb/formatters',
      ),
    ).toBe(true);
    expect(
      isCodelldbNoise('For more information visit: https://go.microsoft.com/fwlink/?linkid=...'),
    ).toBe(true);
  });

  it('保留正常输出（Starting / Launched process / libtest 行）', () => {
    expect(isCodelldbNoise('Starting: Debug test: parse_simple')).toBe(false);
    expect(isCodelldbNoise('Launched process: /tmp/proj/target/debug/deps/neeko-abc123')).toBe(
      false,
    );
    expect(isCodelldbNoise('running 1 test')).toBe(false);
  });

  it('边界：空串 / 纯换行不滤；噪音词非前缀位置不滤', () => {
    expect(isCodelldbNoise('')).toBe(false);
    expect(isCodelldbNoise('\n')).toBe(false);
    expect(isCodelldbNoise('  Console is in ...')).toBe(false);
  });

  it('噪音 banner 后接更多内容仍按前缀命中（store 已先剥尾部换行）', () => {
    expect(isCodelldbNoise("Console is in 'commands' mode\n(Type .help ...)")).toBe(true);
  });
});
