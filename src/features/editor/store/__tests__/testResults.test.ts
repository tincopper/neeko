import { beforeEach, describe, expect, it } from 'vitest';

import {
  statusForCase,
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
    expect(file).toEqual({ running: false, cases: {} });
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
