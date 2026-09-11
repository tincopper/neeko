import { describe, expect, it } from 'vitest';

import { parseTestCases } from '../runLanguages';
import { isTestFile } from '../testCases';

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

  it('should_match_java_test_and_tests_suffix_files', () => {
    expect(isTestFile('CalculatorTest.java')).toBe(true);
    expect(isTestFile('src/test/java/com/example/CalculatorTest.java')).toBe(true);
    expect(isTestFile('CalculatorTests.java')).toBe(true);
  });

  it('should_match_java_file_containing_test_annotation', () => {
    expect(isTestFile('MathUtils.java', 'public void x() {}\n@Test\nvoid testAdd() {}')).toBe(true);
    // 无内容时无法判定（与 rust 同语义）——*Test.java 后缀已在上方覆盖
    expect(isTestFile('MathUtils.java')).toBe(false);
  });

  it('should_reject_plain_java_and_non_test_files', () => {
    expect(isTestFile('MathUtils.java')).toBe(false);
    expect(isTestFile('MathUtils.java', 'public void testAdd() {}')).toBe(false); // 无 @Test 注解
    expect(isTestFile('testable.java')).toBe(false);
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
  it('should_parse_top_level_tests_and_benchmarks_with_kind', () => {
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
      // P2：benchmark 现在检测（命令形态不同：`-bench` + `-run '^$'`），以 kind 区分
      { name: 'BenchmarkFib', line: 8, lang: 'go', kind: 'benchmark' },
    ]);
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
      // Benchmark 与 Test 混排：按行序输出，且带 kind
      { name: 'BenchmarkB', line: 5, lang: 'go', kind: 'benchmark' },
    ]);
  });

  it('should_return_empty_for_non_go_files', () => {
    const doc = 'func TestAdd(t *testing.T) {}';
    expect(parseTestCases('math/add.go', doc)).toEqual([]);
  });
});

describe('parseTestCases — Java', () => {
  it('should_parse_test_annotation_followed_by_void_method', () => {
    const doc = [
      'package com.example;',
      '',
      'public class CalculatorTest {',
      '    @Test',
      '    void testAdd() {',
      '        assertEquals(2, add(1, 1));',
      '    }',
      '}',
    ].join('\n');
    expect(parseTestCases('src/test/java/com/example/CalculatorTest.java', doc)).toEqual([
      { name: 'testAdd', line: 4, lang: 'java' },
    ]);
  });

  it('should_handle_public_static_and_generic_method_modifiers', () => {
    const doc = [
      'public class FooTest {',
      '    @Test',
      '    public static void testStatic() {}',
      '    @Test',
      '    public <T> void testGeneric() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('FooTest.java', doc)).toEqual([
      { name: 'testStatic', line: 2, lang: 'java' },
      { name: 'testGeneric', line: 4, lang: 'java' },
    ]);
  });

  it('should_skip_other_annotations_and_comments_between_test_and_method', () => {
    const doc = [
      'public class BarTest {',
      '    @Test',
      '    @DisplayName("adds two numbers")',
      '    @Tag("fast")',
      '    // legacy comment',
      '    void testAdd() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('BarTest.java', doc)).toEqual([
      { name: 'testAdd', line: 2, lang: 'java' },
    ]);
  });

  it('should_match_parameterized_and_repeated_test_annotations_as_single_methods', () => {
    // 声明局限：`@ParameterizedTest`/`@RepeatedTest` 文本级按方法名单用例（不建模 invocation）
    const doc = [
      'public class ParamTest {',
      '    @ParameterizedTest',
      '    @ValueSource(ints = {1, 2, 3})',
      '    void testSquares(int n) {}',
      '    @RepeatedTest(5)',
      '    void testRepeated() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('ParamTest.java', doc)).toEqual([
      { name: 'testSquares', line: 2, lang: 'java' },
      { name: 'testRepeated', line: 5, lang: 'java' },
    ]);
  });

  it('should_ignore_lifecycle_annotations_not_ending_in_test', () => {
    const doc = [
      'public class LifecycleTest {',
      '    @BeforeEach',
      '    void setUp() {}',
      '    @AfterEach',
      '    void tearDown() {}',
      '    @Test',
      '    void testReal() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('LifecycleTest.java', doc)).toEqual([
      { name: 'testReal', line: 6, lang: 'java' },
    ]);
  });

  it('should_ignore_comments_and_test_annotation_without_following_method', () => {
    const doc = [
      '// @Test',
      '// void testCommented() {}',
      'public class WeirdTest {',
      '    @Test',
      '    int field = 42;',
      '    @Test',
      '    void testReal() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('WeirdTest.java', doc)).toEqual([
      { name: 'testReal', line: 6, lang: 'java' },
    ]);
  });

  it('should_ignore_non_void_and_non_line_start_methods', () => {
    const doc = [
      'public class TypeTest {',
      '    @Test',
      '    int testReturnsInt() { return 1; }',
      '    @Test',
      '    void testReal() {}',
      '    void helper() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('TypeTest.java', doc)).toEqual([
      { name: 'testReal', line: 4, lang: 'java' },
    ]);
  });

  it('should_handle_test_annotation_with_timeout_args', () => {
    const doc = [
      'public class TimeoutTest {',
      '    @Test(timeout = 500)',
      '    void testTimed() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('TimeoutTest.java', doc)).toEqual([
      { name: 'testTimed', line: 2, lang: 'java' },
    ]);
  });

  it('should_parse_multiple_cases_in_order', () => {
    const doc = [
      'public class MultiTest {',
      '    @Test',
      '    void testFirst() {}',
      '    @Test',
      '    void testSecond() {}',
      '}',
    ].join('\n');
    expect(parseTestCases('MultiTest.java', doc)).toEqual([
      { name: 'testFirst', line: 2, lang: 'java' },
      { name: 'testSecond', line: 4, lang: 'java' },
    ]);
  });

  it('should_return_empty_for_non_java_files', () => {
    const doc = '@Test\nvoid testAdd() {}';
    expect(parseTestCases('MathUtils.java2', doc)).toEqual([]);
    expect(parseTestCases('math/add_test.go', doc)).toEqual([]);
  });
});

describe('parseGoCases — benchmark（P2：gopls 能力的快路径承载）', () => {
  it('识别 Benchmark 函数并标记 kind="benchmark"（Test 保持缺省 = 用例）', () => {
    const doc = [
      'package p',
      '',
      'func TestAdd(t *testing.T) {}',
      'func BenchmarkAdd(b *testing.B) {}',
      'func BenchmarkAddParallel(b *testing.B) {}',
      'func helper() {}',
      'func ExampleFoo() {}',
    ].join('\n');
    expect(parseTestCases('math_test.go', doc)).toEqual([
      { name: 'TestAdd', line: 3, lang: 'go' },
      { name: 'BenchmarkAdd', line: 4, lang: 'go', kind: 'benchmark' },
      { name: 'BenchmarkAddParallel', line: 5, lang: 'go', kind: 'benchmark' },
    ]);
  });
});
