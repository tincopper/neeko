// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
  statusForCase,
  subtestsForCase,
  testResultsFileKey,
  useTestResultsStore,
  type AlignedCaseResult,
} from '../testResults';

const aligned = (caseName: string, status: AlignedCaseResult['status']): AlignedCaseResult => ({
  caseName,
  status,
});

describe('testResults store', () => {
  beforeEach(() => {
    useTestResultsStore.setState({ files: {}, versions: {} });
  });

  it('beginRun_clears_old_results_and_marks_running', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/a.test.ts');
    s.applyResults('p1', 'src/a.test.ts', [aligned('adds', 'passed')]);

    useTestResultsStore.getState().beginRun('p1', 'src/a.test.ts');

    expect(useTestResultsStore.getState().files[testResultsFileKey('p1', 'src/a.test.ts')]).toEqual(
      {
        running: true,
        cases: {},
        subtests: {},
      },
    );
  });

  it('applyResults_lands_statuses_and_finishes_running', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/lib.rs');
    s.applyResults('p1', 'src/lib.rs', [
      { caseName: 'parse_simple', status: 'failed', message: 'assertion failed', duration: 5 },
    ]);

    const file = useTestResultsStore.getState().files[testResultsFileKey('p1', 'src/lib.rs')];
    expect(file.running).toBe(false);
    expect(file.cases['parse_simple']).toEqual({
      status: 'failed',
      message: 'assertion failed',
      duration: 5,
    });
  });

  it('applyResults_with_empty_results_only_clears_running_state', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/lib.rs'); // 编译失败：无任何事件 → 不落状态、running 结束
    s.applyResults('p1', 'src/lib.rs', []);

    const file = useTestResultsStore.getState().files[testResultsFileKey('p1', 'src/lib.rs')];
    expect(file).toEqual({ running: false, cases: {}, subtests: {} });
  });

  it('invalidateFile_removes_all_states_for_the_file', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/lib.rs');
    s.applyResults('p1', 'src/lib.rs', [aligned('parse_simple', 'passed')]);

    useTestResultsStore.getState().invalidateFile('p1', 'src/lib.rs');

    expect(
      useTestResultsStore.getState().files[testResultsFileKey('p1', 'src/lib.rs')],
    ).toBeUndefined();
  });

  it('files_are_isolated_by_project_and_path', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/lib.rs');
    s.applyResults('p1', 'src/lib.rs', [aligned('parse_simple', 'passed')]);

    expect(statusForCase('p2', 'src/lib.rs', 'parse_simple')).toBeNull();
    expect(statusForCase('p1', 'src/other.rs', 'parse_simple')).toBeNull();
    expect(statusForCase('p1', 'src/lib.rs', 'parse_simple')).toEqual({ status: 'passed' });
  });

  it('statusForCase_returns_running_placeholder_while_file_is_running', () => {
    const s = useTestResultsStore.getState();
    s.beginRun('p1', 'src/lib.rs');

    expect(statusForCase('p1', 'src/lib.rs', 'parse_simple')).toEqual({ status: 'running' });

    useTestResultsStore.getState().applyResults('p1', 'src/lib.rs', [aligned('other', 'failed')]);
    // 未命中的用例在 run 结束后无占位状态
    expect(statusForCase('p1', 'src/lib.rs', 'parse_simple')).toBeNull();
  });

  it('mutations_bump_monotonic_version_for_gutter_refresh_signal', () => {
    const s = useTestResultsStore.getState();
    const key = testResultsFileKey('p1', 'src/lib.rs');
    expect(useTestResultsStore.getState().versions[key] ?? 0).toBe(0);

    s.beginRun('p1', 'src/lib.rs');
    const v1 = useTestResultsStore.getState().versions[key] ?? 0;
    s.applyResults('p1', 'src/lib.rs', [aligned('a', 'passed')]);
    const v2 = useTestResultsStore.getState().versions[key] ?? 0;
    useTestResultsStore.getState().invalidateFile('p1', 'src/lib.rs');
    const v3 = useTestResultsStore.getState().versions[key] ?? 0;

    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
  });
});

describe('testResults store — 子测试发现缓存（P3 动态子测试）', () => {
  beforeEach(() => {
    useTestResultsStore.setState({ files: {}, versions: {} });
  });

  it('recordSubtests_stores_discovered_full_names_per_parent', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'pkg/math/add_test.go', 'TestTable', [
      'TestTable/positive',
      'TestTable/zero',
    ]);

    expect(subtestsForCase('p1', 'pkg/math/add_test.go', 'TestTable')).toEqual([
      'TestTable/positive',
      'TestTable/zero',
    ]);
  });

  it('recordSubtests_merges_across_runs_so_single_subtest_runs_do_not_shrink_the_menu', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a', 'TestTable/b']);
    // 单跑 `TestTable/a`：本次只发现 a —— 归并后 b 不丢
    s.recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a']);

    expect(subtestsForCase('p1', 'f_test.go', 'TestTable')).toEqual(['TestTable/a', 'TestTable/b']);
  });

  it('recordSubtests_is_a_noop_without_new_names', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a']);
    const v1 = useTestResultsStore.getState().versions[testResultsFileKey('p1', 'f_test.go')];

    useTestResultsStore.getState().recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a']);

    expect(useTestResultsStore.getState().versions[testResultsFileKey('p1', 'f_test.go')]).toBe(v1);
  });

  it('recordSubtests_ignores_empty_input', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'f_test.go', 'TestTable', []);
    expect(subtestsForCase('p1', 'f_test.go', 'TestTable')).toEqual([]);
  });

  it('discovery_survives_beginRun_but_is_dropped_on_file_invalidation', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a']);
    // 新一次 run 只清状态（cases），不清发现缓存 —— 否则菜单在运行瞬间闪空
    s.beginRun('p1', 'f_test.go');
    expect(subtestsForCase('p1', 'f_test.go', 'TestTable')).toEqual(['TestTable/a']);

    // 文件编辑 → 全条目失效（发现缓存与源码内容绑定，改名/删用例后必须重发现）
    useTestResultsStore.getState().invalidateFile('p1', 'f_test.go');
    expect(subtestsForCase('p1', 'f_test.go', 'TestTable')).toEqual([]);
  });

  it('subtests_are_isolated_by_project_path_and_parent', () => {
    const s = useTestResultsStore.getState();
    s.recordSubtests('p1', 'f_test.go', 'TestTable', ['TestTable/a']);
    s.recordSubtests('p1', 'f_test.go', 'TestOther', ['TestOther/z']);

    expect(subtestsForCase('p1', 'f_test.go', 'TestOther')).toEqual(['TestOther/z']);
    expect(subtestsForCase('p2', 'f_test.go', 'TestTable')).toEqual([]);
    expect(subtestsForCase('p1', 'g_test.go', 'TestTable')).toEqual([]);
    expect(subtestsForCase('p1', 'f_test.go', 'TestMissing')).toEqual([]);
  });
});
