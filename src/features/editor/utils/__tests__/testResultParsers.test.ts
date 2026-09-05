import { describe, expect, it } from 'vitest';

import {
  MAX_REPORT_CHARS,
  matchCaseName,
  parseLibtestJsonLines,
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
