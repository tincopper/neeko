import type { LspDiagnostic } from '../../types';
import { diagnosticCodeBadge, diagnosticCodeTooltip } from '../diagnosticCode';

function diag(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 1,
    message: 'boom',
    source: 'javac',
    ...overrides,
  };
}

describe('diagnosticCodeBadge', () => {
  it('字符串 code（人类可读）照原样展示', () => {
    expect(diagnosticCodeBadge(diag({ code: 'UndeclaredName' }))).toEqual({
      label: 'UndeclaredName',
    });
  });

  it('字符串 code + 诊断文档 → 可点链接，文案仍是 code', () => {
    const badge = diagnosticCodeBadge(
      diag({ code: 'UndeclaredName', codeDescription: { href: 'https://example.com/u' } }),
    );
    expect(badge).toEqual({ label: 'UndeclaredName', href: 'https://example.com/u' });
  });

  it('无 code → 不渲染', () => {
    expect(diagnosticCodeBadge(diag({ code: undefined }))).toBeNull();
  });

  /// JDT/JDTLS 把 Eclipse `IProblem` 的内部 ID 当 code 发出来（如 16777218 =
  /// 0x01000002），那是机器标识而不是给人看的文案 → 不作为徽标展示。
  it('纯数字 code 且无文档链接 → 不渲染（案例：Java 的 16777218）', () => {
    expect(diagnosticCodeBadge(diag({ code: 16777218, source: 'javac' }))).toBeNull();
  });

  it('数字形态的字符串 code 同样不渲染（JSON 里可能已经是 string）', () => {
    expect(diagnosticCodeBadge(diag({ code: '16777218' }))).toBeNull();
  });

  it('数字 code 但服务器给了文档链接 → 保留链接，文案换 source 名', () => {
    const badge = diagnosticCodeBadge(
      diag({
        code: 16777218,
        source: 'javac',
        codeDescription: { href: 'https://example.com/jdt' },
      }),
    );
    expect(badge).toEqual({ label: 'javac', href: 'https://example.com/jdt' });
  });

  it('数字 code 有链接但无 source → 文案兜底 docs（不暴露那串数字）', () => {
    const badge = diagnosticCodeBadge(
      diag({ code: 16777218, source: null, codeDescription: { href: 'https://example.com/j' } }),
    );
    expect(badge).toEqual({ label: 'docs', href: 'https://example.com/j' });
  });

  it('空 codeDescription 不当链接', () => {
    expect(diagnosticCodeBadge(diag({ code: 'X', codeDescription: { href: '' } }))).toEqual({
      label: 'X',
    });
  });
});

describe('diagnosticCodeTooltip', () => {
  /// TS 的 `2339` 也是纯数字、确实有用 → 行内不占位置，但悬停必须还能查到。
  it('数字 code 不展示但原值进 tooltip', () => {
    expect(diagnosticCodeTooltip(diag({ code: 2339 }))).toBe('Code: 2339');
    expect(diagnosticCodeTooltip(diag({ code: 16777218 }))).toBe('Code: 16777218');
  });

  it('数字 code 已有文档链接时 tooltip 仍给出原值', () => {
    const d = diag({ code: 16777218, codeDescription: { href: 'https://example.com/j' } });
    expect(diagnosticCodeTooltip(d)).toBe('Code: 16777218');
    expect(diagnosticCodeBadge(d)).toEqual({ label: 'javac', href: 'https://example.com/j' });
  });

  it('已展示的字符串 code 不需要 tooltip', () => {
    expect(diagnosticCodeTooltip(diag({ code: 'UndeclaredName' }))).toBeUndefined();
  });

  it('无 code 无 tooltip', () => {
    expect(diagnosticCodeTooltip(diag({ code: undefined }))).toBeUndefined();
  });
});
