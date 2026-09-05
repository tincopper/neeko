/**
 * 测试命令构造纯函数 + cargo 构建输出解析（editor 内联 Run/Debug 按钮用）。
 *
 * 命令经任务会话按项目环境执行（`sh -c` / `cmd /c` 由统一执行门面处理）；
 * 引号/空格统一 POSIX 单引号转义（WSL/SSH/macOS/Linux 均为 POSIX shell）。
 *
 * P1 结构化结果流（gutter ✓/✗ 状态回显）：
 * - Rust run 追加 libtest JSON（`-- -Z unstable-options --format=json --show-output`，
 *   `--` 之后才是 libtest 参数；`--manifest-path` 保持在 cargo 子命令前）。
 *   `-Z unstable-options` 在 stable 工具链需要 `RUSTC_BOOTSTRAP=1`（rust-analyzer
 *   test_runner.rs 同方案）。任务会话（startTaskProcessSession → terminal manager
 *   spawn）不支持 env 注入，故用 POSIX shell 前缀 `RUSTC_BOOTSTRAP=1 cargo …`；
 *   *Windows 本地限制*：cmd.exe 不支持 `VAR=x cmd` 前缀语法，Windows 本地 Run 的
 *   libtest JSON 不可用（回退语义 = 后端解析空结果），WSL/SSH 目标为 POSIX shell 不受影响。
 * - TS run 追加组合 reporter：`--reporter=default`（Task Console 人类可读）+
 *   `--reporter=json --outputFile.json=<报告路径>`（onExit 后读文件解析）。
 *   禁止 `stdout: true` JSON 模式 —— 官方 WARNING：stdout 报告与终端输出混流不可解析。
 *   报告落 `<runRoot>/node_modules/.neeko/vitest-report.json`（node_modules 天然
 *   gitignored）；vitest json reporter 自建输出目录（dist 实证 mkdir recursive）。
 */

import type { TestCaseInfo } from './testCases';

/** POSIX 单引号转义：内嵌 `'` → `'\''`。 */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** vitest JSON 报告的 run 根下相对路径（读取侧与命令侧共用同一常量，保证路径一致）。 */
export const VITEST_REPORT_REL_PATH = 'node_modules/.neeko/vitest-report.json';

/** vitest JSON 报告绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildVitestReportPath(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${VITEST_REPORT_REL_PATH}` : VITEST_REPORT_REL_PATH;
}

/**
 * Run 命令（P1 结构化结果流版）：
 * - Rust `RUSTC_BOOTSTRAP=1 cargo test <name>[ --manifest-path …] -- -Z unstable-options
 *   --format=json --show-output`（libtest JSON 行，env 前缀与 Windows 限制见文件头）。
 * - TS `pnpm vitest run <relPath> -t <name> --reporter=default --reporter=json
 *   --outputFile.json=<报告路径>`（default 进 Task Console，json 落文件供 onExit 读取）。
 *
 * `cargoManifestDir`：清单所在目录相对项目根的路径（如 Tauri 布局的
 * `src-tauri`）。cargo 只向上查找清单，项目根无 `Cargo.toml` 时必须显式
 * `--manifest-path`，否则 exit 101。为空/undefined 时不追加（根清单布局）。
 * `runRoot`：TS 报告路径的 run 根（worktree 根或项目根）；为空时回退相对路径。
 *
 * 不用 `--exact`：libtest 的 exact 匹配完整测试路径（如 `tests::case`），仅传
 * fn 名时 `mod tests` 嵌套用例会匹配 0 个；子串过滤对根级/嵌套用例均可命中，
 * 同名用例可能多跑——输出可见，可接受（MVP，模块路径透传待后续）。
 */
export function buildRunCommand(
  testCase: TestCaseInfo,
  relPath: string,
  cargoManifestDir?: string | null,
  runRoot?: string | null,
): string {
  if (testCase.lang === 'rust') {
    return (
      `RUSTC_BOOTSTRAP=1 cargo test ${shQuote(testCase.name)}` +
      `${buildManifestArgs(cargoManifestDir)} -- -Z unstable-options --format=json --show-output`
    );
  }
  return (
    `pnpm vitest run ${shQuote(relPath)} -t ${shQuote(testCase.name)}` +
    ` --reporter=default --reporter=json --outputFile.json=${shQuote(buildVitestReportPath(runRoot ?? ''))}`
  );
}

/** `--manifest-path '<dir>/Cargo.toml'`（有目录提示时）；否则空串。 */
function buildManifestArgs(cargoManifestDir?: string | null): string {
  if (!cargoManifestDir) return '';
  return ` --manifest-path ${shQuote(`${cargoManifestDir.replace(/[/\\]+$/, '')}/Cargo.toml`)}`;
}

/**
 * Rust Debug 前置构建命令：`cargo test <caseName> --no-run`（Task Console 可见）。
 * Debug 首期仅支持 Rust —— 非 Rust 用例直接抛错（UI 已按 lang 隐藏 Debug 按钮）。
 */
export function buildDebugBuildCommand(
  testCase: TestCaseInfo,
  cargoManifestDir?: string | null,
): string {
  if (testCase.lang !== 'rust') {
    throw new Error(`Debug is only supported for Rust tests, got: ${testCase.lang}`);
  }
  return `cargo test ${shQuote(testCase.name)} --no-run${buildManifestArgs(cargoManifestDir)}`;
}

/** 任务 Console 会话 configId：按 run/debug + 语言 + 文件 + 用例名隔离标签页。 */
export function buildTestConfigId(
  kind: 'run' | 'debug',
  testCase: TestCaseInfo,
  relPath: string,
): string {
  return `testcase:${kind}:${testCase.lang}:${relPath}:${testCase.name}`;
}

/**
 * 解析 `cargo test --no-run` 输出中的单元测试二进制路径。
 *
 * 匹配 `Running unittests src/lib.rs (target/debug/deps/...)` 行（新 cargo）与
 * `Executable unittests ...` 行（旧 cargo）。`sourceHint` 为被编辑文件相对路径
 * （如 `src/lib.rs`）：多二进制工作区中优先取源文件匹配的二进制，否则取最后一个。
 * 无匹配返回 null（调用方不启动调试会话）。
 */
export function parseTestBinaryPath(output: string, sourceHint?: string): string | null {
  const re = /(?:Running|Executable)\s+unittests\s+(\S+)\s+\(([^)]+)\)/g;
  const candidates: Array<{ source: string; binary: string }> = [];
  for (const m of output.matchAll(re)) {
    candidates.push({ source: m[1], binary: m[2] });
  }
  if (candidates.length === 0) return null;
  if (sourceHint) {
    const matched = candidates.find(
      (c) =>
        c.source === sourceHint ||
        c.source.endsWith(`/${sourceHint}`) ||
        sourceHint.endsWith(`/${c.source}`),
    );
    if (matched) return matched.binary;
  }
  return candidates[candidates.length - 1].binary;
}

/** 相对二进制路径 → 绝对路径（cargo 在 cwd 下输出 `target/...` 相对路径）。 */
export function resolveBinaryPath(binary: string, cwd: string): string {
  if (binary.startsWith('/') || /^[A-Za-z]:[\\/]/.test(binary)) return binary;
  return `${cwd.replace(/[/\\]+$/, '')}/${binary}`;
}

/** 合成 lldb launch 配置：program = 测试二进制，args = [name]（libtest 子串过滤，理由同 buildRunCommand）。 */
export function buildDebugLaunchConfig(
  testCase: TestCaseInfo,
  program: string,
  workspaceRoot: string,
): {
  name: string;
  type: string;
  request: string;
  program: string;
  cwd: string;
  args: string[];
  stopOnEntry: boolean;
} {
  return {
    name: `Debug test: ${testCase.name}`,
    type: 'lldb',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    args: [testCase.name],
    stopOnEntry: false,
  };
}
