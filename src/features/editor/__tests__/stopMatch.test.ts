// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { debugPathsMatch, resolveDebugHighlightLine } from '../stopMatch';

describe('debugPathsMatch — 只做路径形态容错，不做身份转换', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  it('形态差异（重复/尾斜杠、反斜杠）归一后相等', () => {
    expect(debugPathsMatch('/repo//a.go', '/repo/a.go')).toBe(true);
    expect(debugPathsMatch('/repo/a.go/', '/repo/a.go')).toBe(true);
    expect(debugPathsMatch('C:\\repo\\a.go', 'C:/repo/a.go')).toBe(true);
  });

  it('不同文件 → 不相等', () => {
    expect(debugPathsMatch('/repo/a.go', '/other/b.go')).toBe(false);
    expect(debugPathsMatch('/a/x.go', '/b/x.go')).toBe(false);
  });

  it('**不再**做相对/绝对混比与 basename 猜测（契约变更：那属边界解析）', () => {
    // 旧实现允许「互为后缀」：`/repo/a.go` vs `a.go` 会命中 —— 也会让任意目录下的同名文件误命中。
    // 现在两侧必须是规范身份（调用方由 sourceIdentityOf/tabIdentityOf 产出）。
    expect(debugPathsMatch('/repo/a.go', 'a.go')).toBe(false);
    expect(debugPathsMatch('/repo/a.go', 'src/a.go')).toBe(false);
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
    expect(resolveDebugHighlightLine('/p/a.go', null, 'stopped')).toBeNull();
  });

  it('should_highlight_when_paths_match_and_stopped', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('should_not_highlight_when_session_running', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'running',
      ),
    ).toBeNull();
  });

  it('should_not_highlight_when_terminated', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'terminated',
      ),
    ).toBeNull();
  });

  it('should_return_null_for_a_location_in_another_file', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/other.go', line: 7 },
        'stopped',
      ),
    ).toBeNull();
  });

  it('absFilePath 为 null（本 tab 无身份）→ 不命中', () => {
    expect(
      resolveDebugHighlightLine(null, { identity: '/Users/me/proj/main.go', line: 7 }, 'stopped'),
    ).toBeNull();
  });

  it('虚拟源码身份同样单参数命中（`dap-source:` 不再需要旁路）', () => {
    expect(
      resolveDebugHighlightLine(
        'dap-source:/42/Foo.java',
        { identity: 'dap-source:/42/Foo.java', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('line < 1 视为无效位置', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 0 },
        'stopped',
      ),
    ).toBeNull();
  });

  it('starting 也按「在停点上」处理（后端瞬时状态），状态缺省不设门', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        'starting',
      ),
    ).toBe(7);
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        { identity: '/Users/me/proj/main.go', line: 7 },
        null,
      ),
    ).toBe(7);
  });
});
