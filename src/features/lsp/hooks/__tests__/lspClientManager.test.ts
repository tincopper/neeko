import { describe, expect, it } from 'vitest';

import { lspClientTimeout, lspMethodLabel, lspRequestTimeoutMessage } from '../lspClientManager';

describe('lspClientTimeout', () => {
  it('java 大超时（jdtls JVM 冷启动慢），其余 15s', () => {
    expect(lspClientTimeout('java')).toBe(120_000);
    expect(lspClientTimeout('rust')).toBe(15_000);
    expect(lspClientTimeout('typescript')).toBe(15_000);
  });
});

describe('lspMethodLabel', () => {
  it('映射常见 LSP 方法到友好功能名（英文）', () => {
    expect(lspMethodLabel('textDocument/hover')).toBe('Hover');
    expect(lspMethodLabel('textDocument/definition')).toBe('Go to Definition');
    expect(lspMethodLabel('textDocument/references')).toBe('Find References');
    expect(lspMethodLabel('textDocument/completion')).toBe('Code Completion');
  });

  it('未命中回退原始方法名', () => {
    expect(lspMethodLabel('textDocument/unknownThing')).toBe('textDocument/unknownThing');
  });
});

describe('lspRequestTimeoutMessage', () => {
  it('裸 "Request timed out" 附上功能名', () => {
    expect(
      lspRequestTimeoutMessage('textDocument/definition', new Error('Request timed out')),
    ).toBe('LSP request timed out (Go to Definition)');
  });

  it('非超时错误原样放行（返回 null）', () => {
    expect(
      lspRequestTimeoutMessage('textDocument/definition', new Error('server crashed')),
    ).toBeNull();
    expect(lspRequestTimeoutMessage('textDocument/definition', 'not an error')).toBeNull();
    expect(lspRequestTimeoutMessage('textDocument/definition', null)).toBeNull();
  });
});
