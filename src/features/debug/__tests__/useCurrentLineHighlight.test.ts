import { describe, expect, it } from 'vitest';

import { debugPathsMatch, resolveDebugHighlightLine } from '../hooks/useCurrentLineHighlight';

describe('debugPathsMatch — 只做路径形态容错，不做身份转换', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  it('普通路径形态容错', () => {
    expect(debugPathsMatch('/repo/a.go', 'a.go')).toBe(true);
    expect(debugPathsMatch('/repo/a.go', '/other/b.go')).toBe(false);
  });

  it('身份转换不在此处：缓存路径与 jdt 身份是两个不同字符串', () => {
    // 归一统一在 sourceIdentityOf（tab 身份 / stoppedAt 写入时）完成；
    // 本函数若再次做身份转换，就是把「两种身份」重新引回消费侧。
    expect(debugPathsMatch(CACHE, JDT)).toBe(false);
    expect(debugPathsMatch(JDT, JDT)).toBe(true);
  });
});

describe('resolveDebugHighlightLine', () => {
  it('should_return_null_when_no_stoppedAt', () => {
    expect(resolveDebugHighlightLine('/p/a.go', 'a.go', null, 'stopped')).toBeNull();
  });

  it('should_highlight_when_paths_match_and_stopped', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('should_not_highlight_when_session_running', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'running',
      ),
    ).toBeNull();
  });

  it('should_not_highlight_when_terminated', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'terminated',
      ),
    ).toBeNull();
  });
});
