import { describe, expect, it } from 'vitest';

import {
  collectSubtestNames,
  MAX_DISCOVERED_SUBTESTS,
  MAX_REPORT_CHARS,
  matchCaseName,
  parseJunitXml,
  parseLibtestJsonLines,
  parseTest2JsonLines,
  parseVitestJsonReport,
} from '../testResultParsers';

describe('parseLibtestJsonLines', () => {
  it('should_map_test_events_to_case_results', () => {
    const text = [
      JSON.stringify({ type: 'suite', event: 'started', test_count: 2 }),
      JSON.stringify({ type: 'test', event: 'started', name: 'tests::parse_simple' }),
      JSON.stringify({
        type: 'test',
        event: 'ok',
        name: 'tests::parse_simple',
        exec_time: 0.0012, // → 1ms（四舍五入到毫秒）
      }),
      JSON.stringify({ type: 'test', event: 'failed', name: 'tests::other', stdout: 'boom' }),
      JSON.stringify({ type: 'test', event: 'ignored', name: 'tests::skipme' }),
      JSON.stringify({ type: 'suite', event: 'ok', passed: 1, failed: 1 }),
    ].join('\n');

    expect(parseLibtestJsonLines(text)).toEqual([
      { name: 'tests::parse_simple', status: 'passed', duration: 1 },
      { name: 'tests::other', status: 'failed', stdout: 'boom' },
      { name: 'tests::skipme', status: 'ignored' },
    ]);
  });

  it('should_drop_non_json_lines_like_rust_analyzer_degrades', () => {
    const text = [
      '   Compiling neeko v0.1.0 (/tmp/proj)',
      '    Finished test [unoptimized + debuginfo] target(s) in 2.11s',
      '     Running unittests src/lib.rs (target/debug/deps/neeko-abc123)',
      JSON.stringify({ type: 'test', event: 'ok', name: 'parse_simple' }),
      '',
    ].join('\n');

    expect(parseLibtestJsonLines(text)).toEqual([{ name: 'parse_simple', status: 'passed' }]);
  });

  it('should_ignore_started_events_and_unknown_event_kinds', () => {
    const text = [
      JSON.stringify({ type: 'test', event: 'started', name: 'a' }),
      JSON.stringify({ type: 'test', event: 'weird', name: 'a' }),
      JSON.stringify({ type: 'bench', event: 'ok', name: 'b' }),
    ].join('\n');

    expect(parseLibtestJsonLines(text)).toEqual([]);
  });

  it('should_return_empty_for_empty_or_json_error_output', () => {
    expect(parseLibtestJsonLines('')).toEqual([]);
    expect(parseLibtestJsonLines('error: could not compile')).toEqual([]);
    expect(parseLibtestJsonLines('{"type":"test" ')).toEqual([]);
  });

  it('should_treat_failed_event_without_stdout_as_message_free', () => {
    const text = JSON.stringify({ type: 'test', event: 'failed', name: 'a' });
    expect(parseLibtestJsonLines(text)).toEqual([{ name: 'a', status: 'failed' }]);
  });
});

describe('parseTest2JsonLines', () => {
  const g = (obj: Record<string, unknown>) => JSON.stringify(obj);

  it('should_map_terminal_actions_to_case_results', () => {
    const text = [
      g({ Action: 'run', Package: 'math', Test: 'TestAdd' }),
      g({ Action: 'pass', Package: 'math', Test: 'TestAdd', Elapsed: 0.0012 }),
      g({ Action: 'fail', Package: 'math', Test: 'TestSub' }),
      g({ Action: 'skip', Package: 'math', Test: 'TestSkip' }),
      g({ Action: 'pass', Package: 'math', Elapsed: 0.1 }),
    ].join('\n');

    expect(parseTest2JsonLines(text)).toEqual([
      { name: 'TestAdd', status: 'passed', duration: 1 },
      { name: 'TestSub', status: 'failed' },
      { name: 'TestSkip', status: 'ignored' },
    ]);
  });

  it('should_accumulate_output_and_attach_to_failed_cases', () => {
    const text = [
      g({ Action: 'run', Test: 'TestAdd' }),
      g({ Action: 'output', Test: 'TestAdd', Output: '=== RUN   TestAdd\n' }),
      g({ Action: 'output', Test: 'TestAdd', Output: 'add_test.go:10: expected 2, got 3\n' }),
      g({ Action: 'fail', Test: 'TestAdd', Elapsed: 0.01 }),
      g({ Action: 'pass', Test: 'TestPassed' }),
    ].join('\n');

    expect(parseTest2JsonLines(text)).toEqual([
      {
        name: 'TestAdd',
        status: 'failed',
        duration: 10,
        stdout: 'add_test.go:10: expected 2, got 3\n',
      },
      { name: 'TestPassed', status: 'passed' },
    ]);
  });

  it('should_drop_non_json_and_package_level_events', () => {
    const text = [
      'ok  \tmath\t0.123s',
      g({ Action: 'output', Package: 'math', Output: 'PASS\n' }),
      g({ Action: 'pass', Package: 'math', Elapsed: 0.1 }),
      g({ Action: 'run', Test: 'TestAdd' }),
    ].join('\n');

    expect(parseTest2JsonLines(text)).toEqual([]);
  });

  it('should_ignore_pause_cont_and_unknown_actions', () => {
    const text = [
      g({ Action: 'run', Test: 'TestParallel' }),
      g({ Action: 'pause', Test: 'TestParallel' }),
      g({ Action: 'cont', Test: 'TestParallel' }),
      g({ Action: 'pass', Test: 'TestParallel' }),
    ].join('\n');

    expect(parseTest2JsonLines(text)).toEqual([{ name: 'TestParallel', status: 'passed' }]);
  });

  it('should_return_empty_for_empty_or_json_error_output', () => {
    expect(parseTest2JsonLines('')).toEqual([]);
    expect(parseTest2JsonLines('go: cannot find main module')).toEqual([]);
    expect(parseTest2JsonLines('{"Action":"pass" ')).toEqual([]);
  });

  it('should_not_attach_failed_output_to_passed_cases_or_subtests', () => {
    // 子测试失败输出归到子测试（`TestFoo/sub`），父级 `TestFoo` 终态 failed 但
    // 无输出——源码侧只按 fn 名对齐顶层，子测试事件自然丢弃。
    const text = [
      g({ Action: 'output', Test: 'TestFoo/sub', Output: 'sub_test.go:1: boom\n' }),
      g({ Action: 'fail', Test: 'TestFoo/sub' }),
      g({ Action: 'fail', Test: 'TestFoo' }),
    ].join('\n');

    expect(parseTest2JsonLines(text)).toEqual([
      { name: 'TestFoo/sub', status: 'failed', stdout: 'sub_test.go:1: boom\n' },
      { name: 'TestFoo', status: 'failed' },
    ]);
  });
});

describe('collectSubtestNames（P3 动态子测试发现）', () => {
  const g = (obj: Record<string, unknown>) => JSON.stringify(obj);
  const eventsOf = (lines: Record<string, unknown>[]) =>
    parseTest2JsonLines(lines.map(g).join('\n'));

  it('should_discover_subtests_of_the_parent_sorted_by_name', () => {
    // 夹具形状取自真机 `go test -json`（1.26.4）：父级 + 各子测试各一条 `run`，
    // 子测试在 `Test` 字段以 `/` 扁平（`TestTable/positive`）；发现只消费终态事件。
    const events = eventsOf([
      { Action: 'run', Package: 'p', Test: 'TestTable' },
      { Action: 'run', Package: 'p', Test: 'TestTable/zero' },
      { Action: 'pass', Package: 'p', Test: 'TestTable/zero' },
      { Action: 'run', Package: 'p', Test: 'TestTable/positive' },
      { Action: 'pass', Package: 'p', Test: 'TestTable/positive' },
      { Action: 'pass', Package: 'p', Test: 'TestTable' },
      // 无关用例的子测试（同一次运行内若过滤器更宽）不得混入
      { Action: 'run', Package: 'p', Test: 'TestOther/x' },
    ]);

    expect(collectSubtestNames(events, 'TestTable')).toEqual([
      'TestTable/positive',
      'TestTable/zero',
    ]);
  });

  it('should_order_nested_levels_parent_before_child', () => {
    // 终态事件天生「子先于父」；排序还原层级顺序（`outer` 先于 `outer/inner`）。
    const events = eventsOf([
      { Action: 'pass', Package: 'p', Test: 'TestNested/outer/inner' },
      { Action: 'pass', Package: 'p', Test: 'TestNested/outer' },
      { Action: 'pass', Package: 'p', Test: 'TestNested' },
    ]);

    // 每一层都是可直接单跑的合法目标（`outer` 会连 `inner` 一起跑）
    expect(collectSubtestNames(events, 'TestNested')).toEqual([
      'TestNested/outer',
      'TestNested/outer/inner',
    ]);
  });

  it('should_dedupe_repeated_names_across_actions', () => {
    const events = eventsOf([
      { Action: 'run', Package: 'p', Test: 'TestTable/a' },
      { Action: 'output', Package: 'p', Test: 'TestTable/a', Output: 'hi\n' },
      { Action: 'pass', Package: 'p', Test: 'TestTable/a' },
    ]);

    expect(collectSubtestNames(events, 'TestTable')).toEqual(['TestTable/a']);
  });

  it('should_return_empty_when_only_the_parent_ran', () => {
    expect(
      collectSubtestNames(eventsOf([{ Action: 'pass', Package: 'p', Test: 'TestAdd' }]), 'TestAdd'),
    ).toEqual([]);
  });

  it('should_require_slash_boundary_so_prefixed_siblings_are_not_collected', () => {
    // `TestTableExtra/x` 与 `TestTable/x` 前缀相同但不属同一顶层用例 —— `/` 边界必须成立。
    const events = eventsOf([
      { Action: 'run', Package: 'p', Test: 'TestTableExtra/x' },
      { Action: 'run', Package: 'p', Test: 'TestTable' },
    ]);

    expect(collectSubtestNames(events, 'TestTable')).toEqual([]);
  });

  it('should_cap_discovery_to_the_guard', () => {
    const many = Array.from({ length: MAX_DISCOVERED_SUBTESTS + 25 }, (_, i) => ({
      Action: 'pass',
      Package: 'p',
      Test: `TestFuzz/case_${i}`,
    }));

    // 按发现序截断前 MAX 个（case_0..case_199），再排序（字典序 → case_0 仍最小）
    const names = collectSubtestNames(eventsOf(many), 'TestFuzz');
    expect(names).toHaveLength(MAX_DISCOVERED_SUBTESTS);
    expect(names[0]).toBe('TestFuzz/case_0');
    expect(names).not.toContain(`TestFuzz/case_${MAX_DISCOVERED_SUBTESTS}`);
  });
});

describe('parseVitestJsonReport', () => {
  it('should_map_assertion_results_to_case_results', () => {
    const report = {
      numTotalTests: 3,
      testResults: [
        {
          name: '/tmp/proj/src/a.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['math'],
              fullName: 'math adds numbers',
              title: 'adds numbers',
              status: 'passed',
              duration: 3,
              failureMessages: [],
            },
            {
              ancestorTitles: ['math'],
              fullName: 'math divides',
              title: 'divides',
              status: 'failed',
              duration: 1,
              failureMessages: ['expected 2 to be 3'],
            },
            {
              ancestorTitles: ['math'],
              fullName: 'math skips',
              title: 'skips',
              status: 'skipped',
              duration: null,
              failureMessages: [],
            },
          ],
        },
      ],
    };

    expect(parseVitestJsonReport(JSON.stringify(report))).toEqual([
      { fullName: 'math adds numbers', status: 'passed', duration: 3 },
      { fullName: 'math divides', status: 'failed', duration: 1, message: 'expected 2 to be 3' },
      { fullName: 'math skips', status: 'skipped' },
    ]);
  });

  it('should_map_todo_and_pending_statuses_to_skipped', () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            { fullName: 'a todo case', status: 'todo' },
            { fullName: 'a pending case', status: 'pending' },
          ],
        },
      ],
    };

    expect(parseVitestJsonReport(JSON.stringify(report))).toEqual([
      { fullName: 'a todo case', status: 'skipped' },
      { fullName: 'a pending case', status: 'skipped' },
    ]);
  });

  it('should_return_empty_for_malformed_json', () => {
    expect(parseVitestJsonReport('not json')).toEqual([]);
    expect(parseVitestJsonReport('{"testResults": null}')).toEqual([]);
  });

  it('should_skip_reports_over_the_2mb_guard', () => {
    const big = 'x'.repeat(MAX_REPORT_CHARS + 1);
    expect(parseVitestJsonReport(big)).toEqual([]);
  });
});

describe('parseJunitXml', () => {
  // Console Launcher / Surefire / Gradle 兼容 JUnit XML（`--reports-dir` 产物）
  const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.CalculatorTest" tests="3" failures="1" errors="0" skipped="1" time="0.023">
  <testcase name="testAdd" classname="com.example.CalculatorTest" time="0.002"/>
  <testcase name="testFail" classname="com.example.CalculatorTest" time="0.001">
    <failure message="expected 2 to be 3" type="AssertionFailedError">org.opentest4j.AssertionFailedError: expected 2 to be 3&#10;&#9;at com.example.CalculatorTest.testFail(CalculatorTest.java:12)</failure>
  </testcase>
  <testcase name="testSkip" classname="com.example.CalculatorTest" time="0.0">
    <skipped/>
  </testcase>
</testsuite>`;

  it('should_map_testcase_nodes_to_case_results_with_duration_ms', () => {
    const results = parseJunitXml(REPORT);
    expect(results).toEqual([
      { name: 'testAdd', classname: 'com.example.CalculatorTest', status: 'passed', duration: 2 },
      {
        name: 'testFail',
        classname: 'com.example.CalculatorTest',
        status: 'failed',
        duration: 1,
        message: 'expected 2 to be 3',
      },
      // `time="0.0"` → 0ms 耗时（Number('0.0') 有限，照常落 duration: 0）
      { name: 'testSkip', classname: 'com.example.CalculatorTest', status: 'skipped', duration: 0 },
    ]);
  });

  it('should_treat_error_child_as_failed_with_text_message', () => {
    const xml = `
<testsuite name="A" tests="1" failures="0" errors="1" time="0.01">
  <testcase name="boom" classname="com.A" time="0.01">
    <error>NullPointerException: npe</error>
  </testcase>
</testsuite>`;
    expect(parseJunitXml(xml)).toEqual([
      {
        name: 'boom',
        classname: 'com.A',
        status: 'failed',
        duration: 10,
        message: 'NullPointerException: npe',
      },
    ]);
  });

  it('should_skip_cases_missing_name_or_classname', () => {
    const xml = `
<testsuite name="A" tests="1" time="0.01">
  <testcase time="0.01"/>
  <testcase name="onlyName" time="0.01"/>
</testsuite>`;
    expect(parseJunitXml(xml)).toEqual([]);
  });

  it('should_handle_missing_time_and_failure_without_message', () => {
    const xml = `
<testsuite name="A" tests="1" time="0">
  <testcase name="mystery" classname="com.A">
    <failure>stack only</failure>
  </testcase>
</testsuite>`;
    expect(parseJunitXml(xml)).toEqual([
      { name: 'mystery', classname: 'com.A', status: 'failed', message: 'stack only' },
    ]);
  });

  it('should_ignore_container_nodes_and_system_output', () => {
    const xml = `
<testsuites tests="1" failures="0" time="0.02">
  <testsuite name="com.A" tests="1" time="0.02">
    <properties><property name="x" value="y"/></properties>
    <testcase name="ok" classname="com.A" time="0.02"/>
    <system-out>stdout noise</system-out>
  </testsuite>
</testsuites>`;
    expect(parseJunitXml(xml)).toEqual([
      { name: 'ok', classname: 'com.A', status: 'passed', duration: 20 },
    ]);
  });

  it('should_return_empty_for_malformed_xml', () => {
    expect(parseJunitXml('not xml at all')).toEqual([]);
    expect(parseJunitXml('<testsuite><testcase')).toEqual([]);
    expect(parseJunitXml('')).toEqual([]);
  });

  it('should_skip_reports_over_the_2mb_guard', () => {
    const big = 'x'.repeat(MAX_REPORT_CHARS + 1);
    expect(parseJunitXml(big)).toEqual([]);
  });
});

describe('matchCaseName', () => {
  it('should_match_flat_and_module_prefixed_libtest_names', () => {
    expect(matchCaseName('parse_simple', 'parse_simple')).toBe(true);
    expect(matchCaseName('tests::parse_simple', 'parse_simple')).toBe(true);
    expect(matchCaseName('crate::tests::parse_simple', 'parse_simple')).toBe(true);
  });

  it('should_require_module_path_boundary_for_suffix_match', () => {
    // 子串过滤会误跑 `my_parse_simple`，但状态对齐必须拒绝它（无 :: 边界）
    expect(matchCaseName('my_parse_simple', 'parse_simple')).toBe(false);
    expect(matchCaseName('tests::parse_simple_extra', 'parse_simple')).toBe(false);
  });

  it('should_match_describe_suite_prefixed_vitest_full_names', () => {
    expect(matchCaseName('math adds', 'adds')).toBe(true);
    expect(matchCaseName('outer inner adds numbers', 'adds numbers')).toBe(true);
  });

  it('should_reject_parameterized_runtime_names', () => {
    expect(matchCaseName('math adds 1', 'adds')).toBe(false);
    expect(matchCaseName('math adds %d', 'adds')).toBe(false);
  });

  it('should_reject_when_fn_name_is_longer_than_full_name', () => {
    expect(matchCaseName('adds', 'adds_numbers_long')).toBe(false);
  });
});

describe('parseTest2JsonLines — benchmark（P2；夹具形状取自真机 `go test -json -bench`）', () => {
  /** 事件对象 → test2json 行（用 JSON.stringify 构造，避免手写转义把裸 TAB/换行塞进 JSON 字符串）。 */
  const line = (obj: Record<string, unknown>): string => JSON.stringify(obj);

  /** 实测（go 1.26.4）：benchmark 只有 `run` + `output`，**没有** per-benchmark 终态事件。 */
  const PASSING = [
    line({ Action: 'start', Package: 'example.com/mathprobe' }),
    line({ Action: 'output', Package: 'example.com/mathprobe', Output: 'goos: darwin\n' }),
    line({ Action: 'run', Package: 'example.com/mathprobe', Test: 'BenchmarkAdd' }),
    line({
      Action: 'output',
      Package: 'example.com/mathprobe',
      Test: 'BenchmarkAdd',
      Output: '=== RUN   BenchmarkAdd\n',
    }),
    line({
      Action: 'output',
      Package: 'example.com/mathprobe',
      Test: 'BenchmarkAdd',
      Output: 'BenchmarkAdd\n',
    }),
    line({
      Action: 'output',
      Package: 'example.com/mathprobe',
      Test: 'BenchmarkAdd',
      Output: 'BenchmarkAdd-10   \t1000000000\t         0.2383 ns/op\n',
    }),
    line({ Action: 'output', Package: 'example.com/mathprobe', Output: 'PASS\n' }),
    line({ Action: 'pass', Package: 'example.com/mathprobe', Elapsed: 0.787 }),
  ].join('\n');

  /** 实测：benchmark 内 panic 时 panic 文本挂在 `Test` 的 output 上（可作失败摘要）；终态仍只有包级 `fail`。 */
  const FAILING = [
    line({ Action: 'run', Package: 'p', Test: 'BenchmarkBoom' }),
    line({
      Action: 'output',
      Package: 'p',
      Test: 'BenchmarkBoom',
      Output: '=== RUN   BenchmarkBoom\n',
    }),
    line({
      Action: 'output',
      Package: 'p',
      Test: 'BenchmarkBoom',
      Output: 'panic: runtime error: index out of range [2] with length 1\n',
    }),
    line({ Action: 'output', Package: 'p', Output: 'FAIL\n' }),
    line({ Action: 'fail', Package: 'p', Elapsed: 0.2 }),
  ].join('\n');

  it('包级终态收口 pending benchmark → passed，并携带测量输出（ns/op）', () => {
    const events = parseTest2JsonLines(PASSING);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('BenchmarkAdd');
    expect(events[0].status).toBe('passed');
    // 测量结果留在 stdout：gutter tooltip 展示 ns/op（对 benchmark 而言这是有用信息，不限失败）
    expect(events[0].stdout).toContain('ns/op');
    expect(events[0].stdout).not.toContain('=== RUN');
  });

  it('包级 fail → pending benchmark 收口为 failed，panic 文本作摘要', () => {
    expect(parseTest2JsonLines(FAILING)).toEqual([
      { name: 'BenchmarkBoom', status: 'failed', stdout: expect.stringContaining('panic:') },
    ]);
  });

  it('普通测试路径不受影响（per-test 终态优先，包级 pass 不重复产出）', () => {
    const events = parseTest2JsonLines(
      [
        line({ Action: 'run', Package: 'p', Test: 'TestAdd' }),
        line({ Action: 'pass', Package: 'p', Test: 'TestAdd', Elapsed: 0.01 }),
        line({ Action: 'pass', Package: 'p', Elapsed: 0.2 }),
      ].join('\n'),
    );
    expect(events).toEqual([{ name: 'TestAdd', status: 'passed', duration: 10 }]);
  });
});
