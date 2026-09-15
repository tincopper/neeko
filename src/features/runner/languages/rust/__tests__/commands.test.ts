/**
 * rust 命令构造测试（跑测 / 主入口 / LSP runnable / 产物解析）
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import {
  buildDebugBuildCommand,
  buildRustMainDebugBuildCommand,
  buildRustMainRunCommand,
  buildRustRunCommand,
  parseCargoBinaryPath,
  parseTestBinaryPath,
  resolveTestTargetFlag,
} from '../commands';
import { type RustOverlay } from '../runnables';

const tsCase: TestCaseInfo = { name: 'adds numbers', line: 2, lang: 'ts' };
const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };

// 测试侧只做生产 `planTestRun` / `planMainRun` 的等价两步：解析环境事实 → 调纯构造器。
// rust 命令构造器是**纯函数**（无 IO、无探针），故断言直接调真名，不再包一层。

describe('buildRustRunCommand', () => {
  it('should_build_cargo_test_with_libtest_json_via_posix_env_prefix_for_rust_cases', async () => {
    expect(buildRustRunCommand(rustCase, { manifestDir: null })).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('should_append_manifest_path_before_harness_separator_for_subdir_cargo_layouts', async () => {
    expect(buildRustRunCommand(rustCase, { manifestDir: 'src-tauri' })).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' --manifest-path 'src-tauri/Cargo.toml'" +
        ' -- -Z unstable-options --format=json --show-output',
    );
  });

  it('should_not_append_manifest_args_for_null_hint', async () => {
    expect(buildRustRunCommand(rustCase, { manifestDir: null })).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('rust 命令可同步构造：无 await、无探针', () => {
    expect(buildRustRunCommand(rustCase, { manifestDir: null })).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
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

describe('buildRustMainRunCommand', () => {
  it('Rust：cargo run + manifest-path（workspace member）', async () => {
    expect(buildRustMainRunCommand({ manifestDir: 'crates/app' })).toBe(
      "cargo run --manifest-path 'crates/app/Cargo.toml'",
    );
  });

  it('Rust：无 manifest 时 cargo run 裸跑（cwd = run 根）', async () => {
    expect(buildRustMainRunCommand({ manifestDir: null })).toBe('cargo run');
  });
});

describe('buildRustMainDebugBuildCommand', () => {
  it('Rust：cargo build --message-format=json（含 manifest-path）', async () => {
    expect(buildRustMainDebugBuildCommand({ manifestDir: 'crates/app' })).toBe(
      "cargo build --manifest-path 'crates/app/Cargo.toml' --message-format=json",
    );
  });
});

describe('parseCargoBinaryPath', () => {
  it('取非 test profile 的可执行产物，按 sourceHint 消歧', () => {
    const output = [
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/lib.rs' },
        profile: { test: false },
        executable: null,
      }),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/app',
      }),
      JSON.stringify({ reason: 'build-finished', success: true }),
    ].join('\n');
    expect(parseCargoBinaryPath(output, 'src/main.rs')).toEqual({
      ok: true,
      path: '/p/target/debug/app',
    });
  });

  it('多可执行产物且 hint 无法消歧 → binary_ambiguous', () => {
    const output = [
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/bin/a/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/a',
      }),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/bin/b/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/b',
      }),
    ].join('\n');
    expect(parseCargoBinaryPath(output, 'src/other.rs')).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
  });

  it('排除 test 二进制（与 parseTestBinaryPath 互补）', () => {
    const output = JSON.stringify({
      reason: 'compiler-artifact',
      target: { src_path: '/p/src/main.rs' },
      profile: { test: true },
      executable: '/p/target/debug/deps/app-hash',
    });
    expect(parseCargoBinaryPath(output)).toEqual({ ok: false, error: 'binary_not_found' });
  });
});

describe('tier ① LSP runnable → 命令', () => {
  const specificTest: RustOverlay = {
    label: 'cargo test -p api --bin stock-buddy -- routes::sentiment::tests::test_x --exact',
    kind: 'cargo',
    args: {
      cwd: '/proj/crates/api',
      workspaceRoot: '/proj',
      cargoArgs: ['test', '--package', 'api', '--bin', 'stock-buddy'],
      executableArgs: [
        'routes::sentiment::tests::test_x',
        '--exact',
        '--nocapture',
        '--include-ignored',
      ],
    },
  };
  const mainRun: RustOverlay = {
    label: 'cargo run -p api',
    kind: 'cargo',
    args: {
      cwd: '/proj',
      workspaceRoot: '/proj',
      cargoArgs: ['run', '--package', 'api'],
      executableArgs: [],
    },
  };

  it('测试 Run：用 LS 的 target + 完整测试路径 + --exact，并保留本项目结构化结果流参数', () => {
    const cmd = buildRustRunCommand(rustCase, { manifestDir: null, lsp: specificTest });
    expect(cmd).toBe(
      'RUSTC_BOOTSTRAP=1 cargo test --package api --bin stock-buddy -- ' +
        'routes::sentiment::tests::test_x --exact -Z unstable-options --format=json --show-output',
    );
    // --nocapture 会污染 JSON 行；--include-ignored 改变语义 → 均不采用
    expect(cmd).not.toContain('--nocapture');
    expect(cmd).not.toContain('--include-ignored');
  });

  it('测试 Debug 构建：LS 的 target + --no-run --message-format=json', () => {
    expect(buildDebugBuildCommand(rustCase, 'crates/api', '', specificTest)).toBe(
      'cargo test --package api --bin stock-buddy --no-run --message-format=json',
    );
  });

  it('main Run：直接用 LS 的 cargo run 参数（多 bin 工作区不再靠 cargo 报错）', () => {
    expect(buildRustMainRunCommand({ manifestDir: null, lsp: mainRun })).toBe(
      'cargo run --package api',
    );
  });

  it('main Debug 构建：LS 的 run 子命令换成 build + --message-format=json', () => {
    expect(buildRustMainDebugBuildCommand({ manifestDir: null, lsp: mainRun })).toBe(
      'cargo build --package api --message-format=json',
    );
  });

  it('无 LSP runnable 时保持既有快路径命令（回归）', () => {
    expect(buildRustRunCommand(rustCase, { manifestDir: null })).toContain(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple'",
    );
    expect(buildRustMainRunCommand({ manifestDir: null })).toBe('cargo run');
    expect(buildDebugBuildCommand(rustCase, null, '--lib')).toBe(
      "cargo test 'parse_simple' --no-run --lib --message-format=json",
    );
  });
});
