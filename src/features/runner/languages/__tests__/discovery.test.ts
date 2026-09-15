import { describe, expect, it } from 'vitest';

import { discoverRunTargets, isTestCaseFile } from '../index';

describe('isTestCaseFile', () => {
  it('should_match_ts_test_and_spec_files', () => {
    expect(isTestCaseFile('foo.test.ts')).toBe(true);
    expect(isTestCaseFile('foo.test.tsx')).toBe(true);
    expect(isTestCaseFile('foo.spec.js')).toBe(true);
    expect(isTestCaseFile('foo.spec.mjs')).toBe(true);
    expect(isTestCaseFile('src/a/b.test.ts')).toBe(true);
  });

  it('should_reject_plain_ts_files', () => {
    expect(isTestCaseFile('foo.ts')).toBe(false);
    expect(isTestCaseFile('testUtils.ts')).toBe(false);
    expect(isTestCaseFile('foo.tests.ts')).toBe(false);
    expect(isTestCaseFile('latest.ts')).toBe(false);
  });

  it('should_match_rust_file_containing_test_attribute', () => {
    expect(isTestCaseFile('lib.rs', '#[test]\nfn a() {}')).toBe(true);
    expect(isTestCaseFile('lib.rs', '#[tokio::test]\nasync fn a() {}')).toBe(true);
  });

  it('should_reject_rust_file_without_test_attribute_or_content', () => {
    expect(isTestCaseFile('lib.rs', 'fn a() {}')).toBe(false);
    // Without content we cannot know — not a test file.
    expect(isTestCaseFile('lib.rs')).toBe(false);
  });

  it('should_match_go_test_files', () => {
    expect(isTestCaseFile('add_test.go')).toBe(true);
    expect(isTestCaseFile('pkg/sub_add_test.go')).toBe(true);
    expect(isTestCaseFile('pkg/math/calc_test.go')).toBe(true);
  });

  it('should_reject_plain_go_and_non_suffix_files', () => {
    expect(isTestCaseFile('math.go')).toBe(false);
    expect(isTestCaseFile('helper_test.ts')).toBe(false); // ts 是 `*.test.*`（点），非 `_test.go`
  });

  it('should_match_java_test_and_tests_suffix_files', () => {
    expect(isTestCaseFile('CalculatorTest.java')).toBe(true);
    expect(isTestCaseFile('src/test/java/com/example/CalculatorTest.java')).toBe(true);
    expect(isTestCaseFile('CalculatorTests.java')).toBe(true);
  });

  it('should_match_java_file_containing_test_annotation', () => {
    expect(isTestCaseFile('MathUtils.java', 'public void x() {}\n@Test\nvoid testAdd() {}')).toBe(
      true,
    );
    // 无内容时无法判定（与 rust 同语义）——*Test.java 后缀已在上方覆盖
    expect(isTestCaseFile('MathUtils.java')).toBe(false);
  });

  it('should_reject_plain_java_and_non_test_files', () => {
    expect(isTestCaseFile('MathUtils.java')).toBe(false);
    expect(isTestCaseFile('MathUtils.java', 'public void testAdd() {}')).toBe(false); // 无 @Test 注解
    expect(isTestCaseFile('testable.java')).toBe(false);
  });
});

describe('discoverRunTargets.tests — TS/JS', () => {
  it('should_parse_test_and_it_lines_with_names_and_1_based_lines', () => {
    const doc = ["test('adds numbers', () => {", '});', '', "it('works', () => {});"].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([
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
    const cases = discoverRunTargets('a.test.ts', doc).tests;
    expect(cases.map((c) => c.name)).toEqual(['adds', 'subtracts', 'joins']);
    expect(cases.map((c) => c.line)).toEqual([2, 3, 4]);
  });

  it('should_parse_double_quoted_and_template_names', () => {
    const doc = [
      'test("double quoted", () => {});',
      'it(`template name`, () => {});',
      'it(`row ${n} works`, () => {});',
    ].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests.map((c) => c.name)).toEqual([
      'double quoted',
      'template name',
      'row ${n} works',
    ]);
  });

  it('should_ignore_comment_lines（含真实块注释的续行）', () => {
    const doc = [
      '// test("in line comment", () => {});',
      '/* it("in block opener", () => {}); */',
      '/*',
      ' * it("in block continuation", () => {});',
      ' */',
      'test("real", () => {});',
    ].join('\n');
    // AST：注释是 Comment 节点，其内部文本不会成为 CallExpression。
    // （旧夹具的 ` * it(...)` 因上一行 `*/` 已闭合而是**非法 JS**，旧正则靠"trim 后以 * 开头"
    //  的启发式跳过它；这里改用真实的多行块注释形态，语义不变且语法合法。）
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([
      { name: 'real', line: 6, lang: 'ts' },
    ]);
  });

  it('should_detect_test_calls_not_at_line_start（AST 行为改进，见 design §7.9.3）', () => {
    // 旧行正则要求调用必须出现在**行首**，故下面两条被漏掉 —— 那是正则无法区分
    // 「真调用 / 注释 / 字符串」的妥协。AST 能可靠区分，而这两行在运行时**确实注册了测试**
    // （`const runIt = it(...)` 会执行 it()），故现在识别。属**显式记录**的行为改进，非静默变更。
    const doc = [
      "const wrapper = test('wrapped case', () => {});",
      "export const runIt = it('exported case', () => {});",
      "it('real case', () => {});",
    ].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests.map((c) => c.name)).toEqual([
      'wrapped case',
      'exported case',
      'real case',
    ]);
  });

  it('should_parse_nested_describe_blocks（AST 天然支持嵌套）', () => {
    const doc = [
      "describe('outer', () => {",
      "  describe('inner', () => {",
      "    it('deep', () => {});",
      '  });',
      '});',
    ].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([
      { name: 'deep', line: 3, lang: 'ts' },
    ]);
  });

  it('should_not_match_test_calls_inside_string_literals（AST 免疫字符串内假调用）', () => {
    const doc = ['const s = "it(\'fake\', () => {})";', "it('real', () => {});"].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests.map((c) => c.name)).toEqual(['real']);
  });

  it('should_unescape_escaped_quotes_in_names', () => {
    const doc = ["it('it\\'s fine', () => {});"].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([
      { name: "it's fine", line: 1, lang: 'ts' },
    ]);
  });

  it('should_not_match_describe_or_unclosed_names', () => {
    const doc = ["describe('suite', () => {", "  it('multi-line name", '});'].join('\n');
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([]);
  });

  it('should_return_empty_for_non_test_ts_file', () => {
    const doc = "test('not enabled here', () => {});";
    expect(discoverRunTargets('plain.ts', doc).tests).toEqual([]);
  });
});

describe('discoverRunTargets.tests — Rust', () => {
  it('should_parse_test_attribute_followed_by_fn', () => {
    const doc = '#[test]\nfn parse_simple() {\n    assert!(true);\n}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'parse_simple', line: 1, lang: 'rust' },
    ]);
  });

  it('should_parse_tokio_test_with_async_fn', () => {
    const doc = '#[tokio::test]\nasync fn fetches() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'fetches', line: 1, lang: 'rust' },
    ]);
  });

  it('should_parse_tokio_test_with_args', () => {
    const doc = '#[tokio::test(flavor = "multi_thread")]\nasync fn parallel() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'parallel', line: 1, lang: 'rust' },
    ]);
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
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'panics_as_expected', line: 1, lang: 'rust' },
    ]);
  });

  it('should_support_multi_attribute_single_line', () => {
    const doc = '#[test] #[ignore]\nfn slow() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'slow', line: 1, lang: 'rust' },
    ]);
  });

  it('should_not_match_cfg_test_or_non_test_attributes', () => {
    const doc = '#[cfg(test)]\nmod tests {\n    #[test]\n    fn inner() {}\n}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'inner', line: 3, lang: 'rust' },
    ]);
  });

  it('should_skip_attribute_without_following_fn', () => {
    const doc = '#[test]\nlet x = 1;\n#[test]\nfn real() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'real', line: 3, lang: 'rust' },
    ]);
  });

  it('should_extract_name_before_generics_and_parens', () => {
    const doc = '#[test]\nfn generic_case<T: Clone>() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'generic_case', line: 1, lang: 'rust' },
    ]);
  });

  it('should_find_test_attribute_even_when_not_first（多属性须全查，不能只看第一个）', () => {
    // 实现风险点：`AttributeItem` 下 `Attribute` 是**兄弟序列**，测试属性可能在后面。
    // 只检查首个属性的实现会漏掉本用例。
    const doc = '#[ignore] #[test]\nfn slow() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'slow', line: 1, lang: 'rust' },
    ]);
  });

  it('should_not_over_match_tokio_prefixed_attributes（AST 精确匹配，旧正则 startsWith 会误判）', () => {
    // 旧实现用 `startsWith('#[tokio::test')` → `#[tokio::testing]` 会被误认为测试属性。
    // 新实现精确匹配属性名 `tokio::test`。
    const doc = '#[tokio::testing]\nasync fn not_a_case() {}';
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([]);
  });

  it('should_not_match_test_attribute_inside_string_literal（AST 免疫）', () => {
    const doc = ['const S: &str = "#[test] fn fake()";', '#[test]', 'fn real() {}'].join('\n');
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'real', line: 2, lang: 'rust' },
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
    expect(discoverRunTargets('lib.rs', doc).tests).toEqual([
      { name: 'first', line: 2, lang: 'rust' },
      { name: 'second', line: 5, lang: 'rust' },
    ]);
  });
});

describe('discoverRunTargets.tests — Go', () => {
  it('should_not_match_func_decls_inside_strings_or_methods（AST：接收者为 MethodDecl，天然排除）', () => {
    const doc = [
      'package math',
      '',
      'const s = "func TestFake(t *testing.T) {}"',
      'func (s *Suite) TestMethod(t *testing.T) {}',
      'func TestReal(t *testing.T) {}',
    ].join('\n');
    expect(discoverRunTargets('math/add_test.go', doc).tests.map((c) => c.name)).toEqual([
      'TestReal',
    ]);
  });

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
    expect(discoverRunTargets('math/add_test.go', doc).tests).toEqual([
      { name: 'TestAdd', line: 3, lang: 'go' },
      // P2：benchmark 现在检测（命令形态不同：`-bench` + `-run '^$'`），以 kind 区分
      { name: 'BenchmarkFib', line: 8, lang: 'go', variant: 'benchmark' },
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
    expect(discoverRunTargets('math/add_test.go', doc).tests).toEqual([
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
    expect(discoverRunTargets('math/math_test.go', doc).tests).toEqual([
      { name: 'TestA', line: 1, lang: 'go' },
      { name: 'TestB_WithSuffix', line: 3, lang: 'go' },
      // Benchmark 与 Test 混排：按行序输出，且带 kind
      { name: 'BenchmarkB', line: 5, lang: 'go', variant: 'benchmark' },
    ]);
  });

  it('should_return_empty_for_non_go_files', () => {
    const doc = 'func TestAdd(t *testing.T) {}';
    expect(discoverRunTargets('math/add.go', doc).tests).toEqual([]);
  });
});

describe('discoverRunTargets.tests — Java', () => {
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
    expect(discoverRunTargets('src/test/java/com/example/CalculatorTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('FooTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('BarTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('ParamTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('LifecycleTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('WeirdTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('TypeTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('TimeoutTest.java', doc).tests).toEqual([
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
    expect(discoverRunTargets('MultiTest.java', doc).tests).toEqual([
      { name: 'testFirst', line: 2, lang: 'java' },
      { name: 'testSecond', line: 4, lang: 'java' },
    ]);
  });

  it('should_handle_multiple_modifiers_and_fqn_annotation（AST）', () => {
    const doc = [
      'public class DecoratedTest {',
      '    @Test',
      '    public static final synchronized void testDecorated() {}',
      '    @org.junit.jupiter.api.Test',
      '    void testFqnAnnotated() {}',
      '}',
    ].join('\n');
    // FQN 注解：旧正则（行首且不含 `.`）不命中；AST 按名字后缀判定 → 命中（正确性改进）
    expect(discoverRunTargets('DecoratedTest.java', doc).tests).toEqual([
      { name: 'testDecorated', line: 2, lang: 'java' },
      { name: 'testFqnAnnotated', line: 4, lang: 'java' },
    ]);
  });

  it('should_return_empty_for_non_java_files', () => {
    const doc = '@Test\nvoid testAdd() {}';
    expect(discoverRunTargets('MathUtils.java2', doc).tests).toEqual([]);
    expect(discoverRunTargets('math/add_test.go', doc).tests).toEqual([]);
  });
});

describe('Go benchmark 发现 — kind=benchmark（P2：gopls 能力的快路径承载）', () => {
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
    expect(discoverRunTargets('math_test.go', doc).tests).toEqual([
      { name: 'TestAdd', line: 3, lang: 'go' },
      { name: 'BenchmarkAdd', line: 4, lang: 'go', variant: 'benchmark' },
      { name: 'BenchmarkAddParallel', line: 5, lang: 'go', variant: 'benchmark' },
    ]);
  });
});
