import { describe, expect, it } from 'vitest';

import type { TestCaseInfo } from '../testCases';
import {
  buildDebugBuildCommand,
  buildRunCommand,
  buildTestConfigId,
  buildVitestReportPath,
  parseTestBinaryPath,
  resolveBinaryPath,
} from '../testCommands';

const tsCase: TestCaseInfo = { name: 'adds numbers', line: 2, lang: 'ts' };
const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };

describe('buildRunCommand', () => {
  it('should_build_vitest_command_with_json_report_output_for_ts_cases', () => {
    expect(buildRunCommand(tsCase, 'src/a.test.ts', null, '/tmp/proj')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_fall_back_to_relative_report_path_without_run_root', () => {
    expect(buildRunCommand(tsCase, 'src/a.test.ts')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_build_cargo_test_with_libtest_json_via_posix_env_prefix_for_rust_cases', () => {
    expect(buildRunCommand(rustCase, 'src/lib.rs')).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('should_append_manifest_path_before_harness_separator_for_subdir_cargo_layouts', () => {
    expect(buildRunCommand(rustCase, 'src-tauri/tests/x.rs', 'src-tauri')).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' --manifest-path 'src-tauri/Cargo.toml'" +
        ' -- -Z unstable-options --format=json --show-output',
    );
  });

  it('should_not_append_manifest_args_for_null_hint', () => {
    expect(buildRunCommand(rustCase, 'src/lib.rs', null)).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('should_single_quote_escape_names_with_quotes_and_spaces', () => {
    expect(
      buildRunCommand({ ...tsCase, name: "it's fine" }, 'src/a.test.ts', null, '/tmp/proj'),
    ).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'it'\\''s fine'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
    expect(
      buildRunCommand(
        { ...tsCase, name: 'has "double" quotes' },
        'src/a.test.ts',
        null,
        '/tmp/proj',
      ),
    ).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'has "double" quotes'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_quote_relative_paths_containing_spaces', () => {
    expect(buildRunCommand(tsCase, 'src/my folder/a.test.ts', null, '/tmp/proj')).toBe(
      `pnpm vitest run 'src/my folder/a.test.ts' -t 'adds numbers'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });
});

describe('buildVitestReportPath', () => {
  it('should_join_report_path_under_node_modules_neeko_of_project_root', () => {
    expect(buildVitestReportPath('/tmp/proj')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
    expect(buildVitestReportPath('/tmp/proj/')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
  });

  it('should_return_relative_path_for_empty_root', () => {
    expect(buildVitestReportPath('')).toBe('node_modules/.neeko/vitest-report.json');
  });
});

describe('buildDebugBuildCommand', () => {
  it('should_build_cargo_no_run_command_for_rust_cases', () => {
    expect(buildDebugBuildCommand(rustCase)).toBe("cargo test 'parse_simple' --no-run");
  });

  it('should_append_manifest_path_to_no_run_for_subdir_layouts', () => {
    expect(buildDebugBuildCommand(rustCase, 'src-tauri')).toBe(
      "cargo test 'parse_simple' --no-run --manifest-path 'src-tauri/Cargo.toml'",
    );
  });

  it('should_throw_for_non_rust_cases_debug_is_rust_only', () => {
    expect(() => buildDebugBuildCommand(tsCase)).toThrow();
  });
});

describe('buildTestConfigId', () => {
  it('should_build_stable_per_case_ids_distinguishing_run_and_debug', () => {
    const run = buildTestConfigId('run', tsCase, 'src/a.test.ts');
    const debug = buildTestConfigId('debug', rustCase, 'src/lib.rs');
    expect(run).toBe('testcase:run:ts:src/a.test.ts:adds numbers');
    expect(debug).toBe('testcase:debug:rust:src/lib.rs:parse_simple');
    expect(run).not.toBe(debug);
  });
});

describe('parseTestBinaryPath', () => {
  const CARGO_OUTPUT = [
    '   Compiling neeko v0.1.0 (/proj)',
    '    Finished test [unoptimized + debuginfo] target(s) in 2.11s',
    '     Running unittests src/lib.rs (target/debug/deps/neeko-abc123)',
    '     Running unittests src/main.rs (target/debug/deps/neeko-bin-def456)',
  ].join('\n');

  it('should_parse_running_unittests_line', () => {
    expect(
      parseTestBinaryPath('     Running unittests src/lib.rs (target/debug/deps/neeko-abc123)'),
    ).toBe('target/debug/deps/neeko-abc123');
  });

  it('should_parse_legacy_executable_unittests_line', () => {
    expect(
      parseTestBinaryPath('Executable unittests src/lib.rs (target/debug/deps/neeko-abc123)'),
    ).toBe('target/debug/deps/neeko-abc123');
  });

  it('should_return_null_when_no_unittests_line', () => {
    expect(parseTestBinaryPath('Finished in 1s\nRunning target/debug/app')).toBeNull();
    expect(parseTestBinaryPath('')).toBeNull();
  });

  it('should_prefer_source_hint_match_in_multi_binary_workspaces', () => {
    expect(parseTestBinaryPath(CARGO_OUTPUT, 'src/main.rs')).toBe(
      'target/debug/deps/neeko-bin-def456',
    );
    expect(parseTestBinaryPath(CARGO_OUTPUT, 'src/lib.rs')).toBe('target/debug/deps/neeko-abc123');
  });

  it('should_fall_back_to_last_candidate_without_hint_match', () => {
    expect(parseTestBinaryPath(CARGO_OUTPUT)).toBe('target/debug/deps/neeko-bin-def456');
    expect(parseTestBinaryPath(CARGO_OUTPUT, 'src/other.rs')).toBe(
      'target/debug/deps/neeko-bin-def456',
    );
  });
});

describe('resolveBinaryPath', () => {
  it('should_join_relative_paths_with_cwd', () => {
    expect(resolveBinaryPath('target/debug/deps/neeko-abc', '/proj')).toBe(
      '/proj/target/debug/deps/neeko-abc',
    );
  });

  it('should_keep_absolute_paths_untouched', () => {
    expect(resolveBinaryPath('/abs/bin', '/proj')).toBe('/abs/bin');
  });
});
