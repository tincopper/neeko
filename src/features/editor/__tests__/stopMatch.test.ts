import { describe, expect, it } from 'vitest';

import { debugPathsMatch, resolveDebugHighlightLine } from '../stopMatch';

describe('debugPathsMatch — 只做路径形态容错，不做身份转换', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  it('普通路径形态容错', () => {
    expect(debugPathsMatch('/repo/a.go', 'a.go')).toBe(true);
    expect(debugPathsMatch('/repo/a.go', '/other/b.go')).toBe(false);
  });

  it('空值早退：任一侧为空串一律不匹配', () => {
    // 守卫必须显式存在：`'/repo/a.go'.endsWith('/' + '')` 为 true，无此守卫会把「空路径」
    // 判成与任何绝对路径同文件。
    expect(debugPathsMatch('', '/repo/a.go')).toBe(false);
    expect(debugPathsMatch('/repo/a.go', '')).toBe(false);
    expect(debugPathsMatch('', '')).toBe(false);
  });

  it('身份转换不在此处：缓存路径与 jdt 身份是两个不同字符串', () => {
    // 归一统一在 sourceIdentityOf（tab 身份 / location 写入时）完成；
    // 本函数若再次做身份转换，就是把「两种身份」重新引回消费侧。
    expect(debugPathsMatch(CACHE, JDT)).toBe(false);
    expect(debugPathsMatch(JDT, JDT)).toBe(true);
  });
});

describe('resolveDebugHighlightLine — 停点是否落在本 tab（黄线与光标跟随共用同一判定）', () => {
  it('should_return_null_when_no_location', () => {
    expect(resolveDebugHighlightLine('/p/a.go', 'a.go', null, 'stopped')).toBeNull();
  });

  it('should_highlight_when_paths_match_and_stopped', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('should_not_highlight_when_session_running', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'running',
      ),
    ).toBeNull();
  });

  it('should_not_highlight_when_terminated', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'terminated',
      ),
    ).toBeNull();
  });

  it('should_return_null_for_a_location_in_another_file', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { identity: '/Users/me/proj/other.go', line: 7 },
        'stopped',
      ),
    ).toBeNull();
  });
});
