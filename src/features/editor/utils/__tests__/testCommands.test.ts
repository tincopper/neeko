import { describe, expect, it } from 'vitest';

import type { TestCaseInfo } from '../testCases';
import {
  buildDebugBuildCommand,
  buildRunCommand,
  buildTestConfigId,
  buildVitestReportPath,
  parseTestBinaryPath,
  resolveBinaryPath,
  resolveTestTargetFlag,
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
  it('should_build_cargo_no_run_command_with_artifact_json_for_rust_cases', () => {
    // C4：产物定位走结构化协议 —— `--message-format=json` 输出 compiler-artifact，
    // 不再靠正则猜 `Running unittests` 行。
    expect(buildDebugBuildCommand(rustCase)).toBe(
      "cargo test 'parse_simple' --no-run --message-format=json",
    );
  });

  it('should_append_manifest_path_to_no_run_for_subdir_layouts', () => {
    expect(buildDebugBuildCommand(rustCase, 'src-tauri')).toBe(
      "cargo test 'parse_simple' --no-run --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
    );
  });

  it('should_throw_for_non_rust_cases_debug_is_rust_only', () => {
    expect(() => buildDebugBuildCommand(tsCase)).toThrow();
  });

  it('should_append_target_flag_between_no_run_and_manifest', () => {
    expect(buildDebugBuildCommand(rustCase, 'src-tauri', '--lib')).toBe(
      "cargo test 'parse_simple' --no-run --lib --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
    );
    expect(buildDebugBuildCommand(rustCase, null, '--test unit')).toBe(
      "cargo test 'parse_simple' --no-run --test unit --message-format=json",
    );
  });
});

describe('buildTestConfigId', () => {
  it('should_build_stable_per_case_ids_distinguishing_run_and_debug', () => {
    const run = buildTestConfigId('run', tsCase, 'src/a.test.ts');
    const debug = buildTestConfigId('debug', rustCase, 'src/lib.rs');
    expect(debug).toBe('testcase:debug:rust:src/lib.rs:parse_simple');
    expect(run).not.toBe(debug);
  });
});

describe('parseTestBinaryPath', () => {
  // cargo `--message-format=json` 的 compiler-artifact 行（executable 绝对路径，
  // target.src_path 绝对路径；C4：结构化产物定位）。
  const artifact = (executable: string | null, srcPath: string, test = true) =>
    JSON.stringify({
      reason: 'compiler-artifact',
      target: { kind: ['lib'], name: 'neeko', src_path: srcPath },
      profile: { test },
      executable,
    });
  const ARTIFACT_OUTPUT = [
    '   Compiling neeko v0.1.0 (/proj)',
    artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    artifact('/proj/target/debug/deps/neeko_bin-def456', '/proj/src/main.rs'),
  ].join('\n');

  it('should_parse_single_test_artifact_executable', () => {
    expect(
      parseTestBinaryPath(artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs')),
    ).toEqual({ ok: true, path: '/proj/target/debug/deps/neeko-abc123' });
  });

  it('should_discard_non_json_lines_and_non_artifact_reasons', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)',
      '    Finished test [unoptimized + debuginfo] target(s) in 2.11s',
      JSON.stringify({ reason: 'build-finished', success: true }),
      JSON.stringify({ reason: 'compiler-message', message: 'warning: unused' }),
      'not json at all {{{',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_ignore_non_test_profile_and_null_executable_artifacts', () => {
    const output = [
      artifact('/proj/target/debug/deps/libneeko.rlib', '/proj/src/lib.rs', false),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/proj/build.rs' },
        profile: { test: false },
        executable: null,
      }),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({ ok: false, error: 'binary_not_found' });
  });

  it('should_return_binary_not_found_when_no_artifact', () => {
    expect(parseTestBinaryPath('Finished in 1s\nRunning target/debug/app')).toEqual({
      ok: false,
      error: 'binary_not_found',
    });
    expect(parseTestBinaryPath('')).toEqual({ ok: false, error: 'binary_not_found' });
  });

  it('should_prefer_source_hint_match_in_multi_binary_workspaces', () => {
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/main.rs')).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko_bin-def456',
    });
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/lib.rs')).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_return_binary_ambiguous_for_multi_artifacts_without_disambiguating_hint', () => {
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT)).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/other.rs')).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
  });

  it('should_parse_artifact_lines_with_crlf_endings', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)\r',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs') + '\r',
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_parse_artifact_lines_with_ansi_color_prefix', () => {
    const line =
      '\x1b[32m' + artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs') + '\x1b[0m';
    expect(parseTestBinaryPath(`   Compiling neeko v0.1.0 (/proj)\n${line}\n`)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_ignore_truncated_json_line_from_output_cap', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)',
      '{"reason":"compiler-artifact","targe',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
    expect(parseTestBinaryPath('{"reason":"compiler-artifact","targe')).toEqual({
      ok: false,
      error: 'binary_not_found',
    });
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

describe('resolveTestTargetFlag', () => {
  it('should_lock_integration_target_for_tests_files', () => {
    expect(resolveTestTargetFlag('tests/unit.rs', false)).toBe('--test unit');
    // manifest 子目录布局（Tauri `src-tauri/`）：filePath 相对项目根，带前缀
    expect(resolveTestTargetFlag('src-tauri/tests/unit.rs', false)).toBe('--test unit');
  });

  it('should_lock_bin_target_for_src_bin_files', () => {
    expect(resolveTestTargetFlag('src/bin/tool.rs', true)).toBe('--bin tool');
    expect(resolveTestTargetFlag('src/bin/tool/main.rs', true)).toBe('--bin tool');
  });

  it('should_lock_lib_target_for_src_modules_when_lib_exists', () => {
    // 多目标工作区（lib + bin 共享 src/）：artifact 的 src_path 是 crate root，
    // 与源文件行永不匹配 —— 必须靠 `--lib` 构建期锁定，产物唯一。
    expect(resolveTestTargetFlag('src/agent/chat/adapter/serve.rs', true)).toBe('--lib');
    expect(resolveTestTargetFlag('src/lib.rs', true)).toBe('--lib');
  });

  it('should_not_lock_when_no_lib_target_exists', () => {
    // 纯 bin 项目（无 src/lib.rs）：src/ 模块属唯一 bin，不指定目标即唯一候选。
    expect(resolveTestTargetFlag('src/main.rs', false)).toBe('');
    expect(resolveTestTargetFlag('src/tool.rs', false)).toBe('');
  });

  it('should_return_empty_for_unknown_layouts', () => {
    expect(resolveTestTargetFlag('', false)).toBe('');
    expect(resolveTestTargetFlag('README.md', true)).toBe('');
  });
});
