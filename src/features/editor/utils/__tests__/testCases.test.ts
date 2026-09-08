import { describe, expect, it } from 'vitest';

import { isTestFile, parseTestCases } from '../testCases';

describe('isTestFile', () => {
  it('should_match_ts_test_and_spec_files', () => {
    expect(isTestFile('foo.test.ts')).toBe(true);
    expect(isTestFile('foo.test.tsx')).toBe(true);
    expect(isTestFile('foo.spec.js')).toBe(true);
    expect(isTestFile('foo.spec.mjs')).toBe(true);
    expect(isTestFile('src/a/b.test.ts')).toBe(true);
  });

  it('should_reject_plain_ts_files', () => {
    expect(isTestFile('foo.ts')).toBe(false);
    expect(isTestFile('testUtils.ts')).toBe(false);
    expect(isTestFile('foo.tests.ts')).toBe(false);
    expect(isTestFile('latest.ts')).toBe(false);
  });

  it('should_match_rust_file_containing_test_attribute', () => {
    expect(isTestFile('lib.rs', '#[test]\nfn a() {}')).toBe(true);
    expect(isTestFile('lib.rs', '#[tokio::test]\nasync fn a() {}')).toBe(true);
  });

  it('should_reject_rust_file_without_test_attribute_or_content', () => {
    expect(isTestFile('lib.rs', 'fn a() {}')).toBe(false);
    // Without content we cannot know — not a test file.
    expect(isTestFile('lib.rs')).toBe(false);
  });

  it('should_match_go_test_files', () => {
    expect(isTestFile('add_test.go')).toBe(true);
    expect(isTestFile('pkg/sub_add_test.go')).toBe(true);
    expect(isTestFile('pkg/math/calc_test.go')).toBe(true);
  });

  it('should_reject_plain_go_and_non_suffix_files', () => {
    expect(isTestFile('math.go')).toBe(false);
    expect(isTestFile('helper_test.ts')).toBe(false); // ts 是 `*.test.*`（点），非 `_test.go`
  });
});

describe('parseTestCases — TS/JS', () => {
  it('should_parse_test_and_it_lines_with_names_and_1_based_lines', () => {
    const doc = ["test('adds numbers', () => {", '});', '', "it('works', () => {});"].join('\n');
    expect(parseTestCases('a.test.ts', doc)).toEqual([
      { name: 'adds numbers', line: 1, lang: 'ts' },
      { name: 'works', line: 4, lang: 'ts' },
    ]);
  });

  it('should_parse_indented_calls_and_modifiers', () => {
    const doc = [
      'describe("math", () => {',
      '  it.only("adds", () => {});',
      '\ttest.skip("subtracts", () => {});',
      "  it.concurrent('joins', async () => {});",
      '});',
    ].join('\n');
    const cases = parseTestCases('a.test.ts', doc);
    expect(cases.map((c) => c.name)).toEqual(['adds', 'subtracts', 'joins']);
    expect(cases.map((c) => c.line)).toEqual([2, 3, 4]);
  });

  it('should_parse_double_quoted_and_template_names', () => {
    const doc = [
      'test("double quoted", () => {});',
      'it(`template name`, () => {});',
      'it(`row ${n} works`, () => {});',
    ].join('\n');
    expect(parseTestCases('a.test.ts', doc).map((c) => c.name)).toEqual([
      'double quoted',
      'template name',
      'row ${n} works',
    ]);
  });

  it('should_ignore_comment_lines', () => {
    const doc = [
      '// test("in line comment", () => {});',
      '/* it("in block opener", () => {}); */',
      ' * it("in block continuation", () => {});',
      'test("real", () => {});',
    ].join('\n');
    expect(parseTestCases('a.test.ts', doc)).toEqual([{ name: 'real', line: 4, lang: 'ts' }]);
  });

  it('should_ignore_calls_not_at_line_start', () => {
    const doc = [
      "const wrapper = test('not a case', () => {});",
      "export const runIt = it('not a case', () => {});",
      "it('real case', () => {});",
    ].join('\n');
    expect(parseTestCases('a.test.ts', doc)).toEqual([{ name: 'real case', line: 3, lang: 'ts' }]);
  });

  it('should_unescape_escaped_quotes_in_names', () => {
    const doc = ["it('it\\'s fine', () => {});"].join('\n');
    expect(parseTestCases('a.test.ts', doc)).toEqual([{ name: "it's fine", line: 1, lang: 'ts' }]);
  });

  it('should_not_match_describe_or_unclosed_names', () => {
    const doc = ["describe('suite', () => {", "  it('multi-line name", '});'].join('\n');
    expect(parseTestCases('a.test.ts', doc)).toEqual([]);
  });

  it('should_return_empty_for_non_test_ts_file', () => {
    const doc = "test('not enabled here', () => {});";
    expect(parseTestCases('plain.ts', doc)).toEqual([]);
  });
});

describe('parseTestCases — Rust', () => {
  it('should_parse_test_attribute_followed_by_fn', () => {
    const doc = '#[test]\nfn parse_simple() {\n    assert!(true);\n}';
    expect(parseTestCases('lib.rs', doc)).toEqual([
      { name: 'parse_simple', line: 1, lang: 'rust' },
    ]);
  });

  it('should_parse_tokio_test_with_async_fn', () => {
    const doc = '#[tokio::test]\nasync fn fetches() {}';
    expect(parseTestCases('lib.rs', doc)).toEqual([{ name: 'fetches', line: 1, lang: 'rust' }]);
  });

  it('should_parse_tokio_test_with_args', () => {
    const doc = '#[tokio::test(flavor = "multi_thread")]\nasync fn parallel() {}';
    expect(parseTestCases('lib.rs', doc)).toEqual([{ name: 'parallel', line: 1, lang: 'rust' }]);
  });

  it('should_handle_stacked_attributes_blank_and_comment_lines_before_fn', () => {
    const doc = [
      '#[test]',
      '#[ignore]',
      '',
      '// pending rewrite',
      '#[should_panic]',
      'fn panics_as_expected() {}',
    ].join('\n');
    expect(parseTestCases('lib.rs', doc)).toEqual([
      { name: 'panics_as_expected', line: 1, lang: 'rust' },
    ]);
  });

  it('should_support_multi_attribute_single_line', () => {
    const doc = '#[test] #[ignore]\nfn slow() {}';
    expect(parseTestCases('lib.rs', doc)).toEqual([{ name: 'slow', line: 1, lang: 'rust' }]);
  });

  it('should_not_match_cfg_test_or_non_test_attributes', () => {
    const doc = '#[cfg(test)]\nmod tests {\n    #[test]\n    fn inner() {}\n}';
    expect(parseTestCases('lib.rs', doc)).toEqual([{ name: 'inner', line: 3, lang: 'rust' }]);
  });

  it('should_skip_attribute_without_following_fn', () => {
    const doc = '#[test]\nlet x = 1;\n#[test]\nfn real() {}';
    expect(parseTestCases('lib.rs', doc)).toEqual([{ name: 'real', line: 3, lang: 'rust' }]);
  });

  it('should_extract_name_before_generics_and_parens', () => {
    const doc = '#[test]\nfn generic_case<T: Clone>() {}';
    expect(parseTestCases('lib.rs', doc)).toEqual([
      { name: 'generic_case', line: 1, lang: 'rust' },
    ]);
  });

  it('should_parse_multiple_cases_in_order', () => {
    const doc = [
      'mod tests {',
      '    #[test]',
      '    fn first() {}',
      '',
      '    #[tokio::test]',
      '    async fn second() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('lib.rs', doc)).toEqual([
      { name: 'first', line: 2, lang: 'rust' },
      { name: 'second', line: 5, lang: 'rust' },
    ]);
  });
});

describe('parseTestCases — Go', () => {
  it('should_parse_top_level_test_functions_and_ignore_benchmarks', () => {
    const doc = [
      'package math',
      '',
      'func TestAdd(t *testing.T) {',
      '    got := add(1, 2)',
      '    if got != 3 { t.Fatalf("got %d", got) }',
      '}',
      '',
      'func BenchmarkFib(b *testing.B) {',
      '    for i := 0; i < b.N; i++ { _ = fib(i) }',
      '}',
    ].join('\n');
    expect(parseTestCases('math/add_test.go', doc)).toEqual([
      { name: 'TestAdd', line: 3, lang: 'go' },
    ]);
    // Benchmark 不检测（YAGNI：`-run` 过滤与 benchmark 名不匹配），不得出现在结果里
    expect(parseTestCases('math/add_test.go', doc)).not.toContainEqual({
      name: 'BenchmarkFib',
      line: 8,
      lang: 'go',
    });
  });

  it('should_ignore_comments_non_line_start_and_non_test_functions', () => {
    const doc = [
      '// func TestCommented(t *testing.T) {}',
      '/* func TestBlockComment(t *testing.T) {} */',
      'func helper(x int) int { return x }',
      'func (s *Suite) TestMethod(t *testing.T) {}',
      'func TestReal(t *testing.T) {',
      '    t.Run("sub", func(t *testing.T) {})',
      '}',
    ].join('\n');
    expect(parseTestCases('math/add_test.go', doc)).toEqual([
      { name: 'TestReal', line: 5, lang: 'go' },
    ]);
  });

  it('should_parse_multiple_cases_with_line_numbers_in_order', () => {
    const doc = [
      'func TestA(t *testing.T) {}',
      '',
      'func TestB_WithSuffix(t *testing.T) {}',
      '',
      'func BenchmarkB(b *testing.B) {}',
    ].join('\n');
    expect(parseTestCases('math/math_test.go', doc)).toEqual([
      { name: 'TestA', line: 1, lang: 'go' },
      { name: 'TestB_WithSuffix', line: 3, lang: 'go' },
    ]);
    // Benchmark 与 Test 混排时仍不检测，结果不含 BenchmarkB
    expect(parseTestCases('math/math_test.go', doc)).not.toContainEqual({
      name: 'BenchmarkB',
      line: 5,
      lang: 'go',
    });
  });

  it('should_return_empty_for_non_go_files', () => {
    const doc = 'func TestAdd(t *testing.T) {}';
    expect(parseTestCases('math/add.go', doc)).toEqual([]);
  });
});
