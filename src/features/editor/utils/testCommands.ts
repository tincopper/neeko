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

import { fileExists } from '@/features/file/api/fileApi';

import type { ExistsProbe } from './cargoManifest';
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

/** Tauri `file_exists`（O(1) stat，不读内容）——Go go.mod 探测默认探针，与 cargo 清单探测同构。 */
const goExists: ExistsProbe = (absPath) => fileExists(absPath);

/**
 * Go module 根探测：从被编辑文件目录向上找最近 `go.mod`（对齐 Go toolchain 的
 * 模块边界语义），返回相对 `runRoot` 的 module 目录；找不到/探测失败 → null。
 * 复用 `resolveCargoManifestDirForFile` 模式：probe 注入便于测试，默认走
 * Tauri `file_exists`。
 *
 * - 根模块：`go.mod` 在 runRoot → 返回 `''`（module 根 = runRoot）。
 * - 嵌套模块：`go.mod` 在某子目录（如 `submod/`）→ 返回 `'submod'`。
 * - 无 go.mod（runRoot 到文件目录链路均无）→ null（调用方回退文件目录语义）。
 * 搜索有界于 runRoot：module 根在 runRoot 之上时回退 cwd 相对路径（`go` 自会
 * 向上找到 module），无需 `..` 表达。
 */
export async function findGoModuleDir(
  filePath: string,
  runRoot: string,
  probe: ExistsProbe = goExists,
): Promise<string | null> {
  const root = runRoot.replace(/[/\\]+$/, '');
  if (!root || !filePath) return null;
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop(); // 去掉文件名，从所在目录起向上
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/'); // '' = runRoot 自身
    const goMod = dir ? `${root}/${dir}/go.mod` : `${root}/go.mod`;
    try {
      if (await probe(goMod)) return dir;
    } catch {
      return null; // 探测失败（IPC 不可用等）→ 回退文件目录语义，不阻塞运行
    }
  }
  return null;
}

/** 文件所在目录相对 module 根的路径（moduleDir='' 表示 runRoot 自身）。 */
function pkgDirRelativeToModule(filePath: string, moduleDir: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const body = moduleDir ? normalized.slice(moduleDir.length).replace(/^\/+/, '') : normalized;
  const lastSlash = body.lastIndexOf('/');
  return lastSlash >= 0 ? body.slice(0, lastSlash) : '';
}

/**
 * Go 测试文件路径 → 所属包目录（cwd 相对：`./dir` / `.`）。
 * cwd = run 根（worktree 根或项目根）。优先按 module 边界解析：`go.mod` 位于
 * 嵌套模块（如 `submod/`）时返回相对 module 根的包目录（`./pkg/math`，与
 * `go test` 的 module 内包寻址一致）；无 go.mod（或探测失败/无 runRoot）回退
 * 文件所在目录。
 */
export async function goPkgDir(
  filePath: string,
  runRoot?: string | null,
  probe: ExistsProbe = goExists,
): Promise<string> {
  if (runRoot) {
    const moduleDir = await findGoModuleDir(filePath, runRoot, probe);
    if (moduleDir !== null) {
      const rel = pkgDirRelativeToModule(filePath, moduleDir);
      return rel ? `./${rel}` : '.';
    }
  }
  // 回退：文件所在目录（`./dir` / `.` 为 cwd 相对）。
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  return dir ? `./${dir}` : '.';
}

/**
 * Run 命令（P1 结构化结果流版）：
 * - Rust `RUSTC_BOOTSTRAP=1 cargo test <name>[ --manifest-path …] -- -Z unstable-options
 *   --format=json --show-output`（libtest JSON 行，env 前缀与 Windows 限制见文件头）。
 * - Go `go test -run '^Name$' -json <pkg>`（test2json 行式事件，与 libtest 同族；
 *   pkg = 测试文件所属包目录——优先按 module 边界（`go.mod` 向上探测，嵌套 module
 *   取相对 module 根的包目录），无 go.mod 回退文件目录）。
 * - TS `pnpm vitest run <relPath> -t <name> --reporter=default --reporter=json
 *   --outputFile.json=<报告路径>`（default 进 Task Console，json 落文件供 onExit 读取）。
 *
 * `cargoManifestDir`：清单所在目录相对项目根的路径（如 Tauri 布局的
 * `src-tauri`）。cargo 只向上查找清单，项目根无 `Cargo.toml` 时必须显式
 * `--manifest-path`，否则 exit 101。为空/undefined 时不追加（根清单布局）。
 * `runRoot`：TS 报告路径的 run 根 + Go module 探测根（worktree 根或项目根）；
 * 为空时回退相对路径 / 文件目录语义。
 * `probe`：Go module 探测探针（默认 Tauri `file_exists`），测试注入。
 *
 * 不用 `--exact`：libtest 的 exact 匹配完整测试路径（如 `tests::case`），仅传
 * fn 名时 `mod tests` 嵌套用例会匹配 0 个；子串过滤对根级/嵌套用例均可命中，
 * 同名用例可能多跑——输出可见，可接受（MVP，模块路径透传待后续）。
 */
export async function buildRunCommand(
  testCase: TestCaseInfo,
  relPath: string,
  cargoManifestDir?: string | null,
  runRoot?: string | null,
  probe: ExistsProbe = goExists,
): Promise<string> {
  if (testCase.lang === 'rust') {
    return (
      `RUSTC_BOOTSTRAP=1 cargo test ${shQuote(testCase.name)}` +
      `${buildManifestArgs(cargoManifestDir)} -- -Z unstable-options --format=json --show-output`
    );
  }
  if (testCase.lang === 'go') {
    // `-run` 锚定 `^Name$`（子串命中会多跑；debug 0 命中则断点永不触发）。
    // `-json` → test2json 行式事件（与 libtest JSON 同族，共用 TestResultEvent 状态机）。
    // pkg = 测试文件所属包目录（module 感知，见 goPkgDir）。
    const pkg = await goPkgDir(relPath, runRoot, probe);
    return `go test -run ${shQuote(`^${testCase.name}$`)} -json ${shQuote(pkg)}`;
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
 * Rust Debug 前置构建命令：`cargo test <caseName> --no-run [<targetFlag>] --message-format=json`
 * （C4：产物定位走 compiler-artifact 结构化协议）。
 * `--message-format` / `--lib|--bin|--test` 均为 cargo 级 flag（非测试二进制参数），
 * 放 `--` 之前；无 `VAR=x` env 前缀，shell 无关（Windows 本地 cmd 同样可用）。
 * `targetFlag` 为多目标工作区消歧：lib+bin 共享 src/ 时 artifact 的 src_path 是
 * crate root、与源文件行永不匹配（hint 消歧失效），必须在构建期锁定目标使产物唯一。
 * Debug 支持 Rust/Go（§4/§5）：cargo 构建命令只服务 Rust —— 非 Rust 用例直接
 * 抛错；Go 的调试构建走 `buildGoDebugBuildCommand`。UI 已按 lang 只对 Rust/Go
 * 显示 Debug 按钮，此处抛错为防御兜底。
 */
export function buildDebugBuildCommand(
  testCase: TestCaseInfo,
  cargoManifestDir?: string | null,
  targetFlag = '',
): string {
  if (testCase.lang !== 'rust') {
    throw new Error(`Debug is only supported for Rust tests, got: ${testCase.lang}`);
  }
  const target = targetFlag ? ` ${targetFlag}` : '';
  return `cargo test ${shQuote(testCase.name)} --no-run${target}${buildManifestArgs(cargoManifestDir)} --message-format=json`;
}

/**
 * Go Debug 前置构建产物相对路径（cwd 相对，gitignored `.neeko/` 下）。
 * `go test -c -o` 会自建父目录；产物路径显式（`-o`），启动时按此解析，无 compiler-artifact。
 */
export function goDebugBinaryRelPath(name: string): string {
  return `.neeko/test-bin/${name}`;
}

/**
 * Go Debug 前置构建命令（delve `pkg/gobuild` 的公开常量，GoLand/Zed mode:exec 一字不差复用）：
 * `go test -c -o <out> -gcflags all=-N -l <pkg>`。
 * `-gcflags all=-N -l` 无优化构建是断点/变量正确性前提（delve#4165）；`-o` 显式产物路径，
 * 比 Rust 的 compiler-artifact 解析更简单（解析 `<out>` 即可）。`<pkg>` 为测试文件所属
 * 包目录（cwd 相对 `./dir` / `.`）。
 */
export function buildGoDebugBuildCommand(pkgDir: string, outRelPath: string): string {
  // `-gcflags` 的值 `all=-N -l` 必须是单个 argv token（delve gobuild 的 `-gcflags=all=-N -l`
  // 是代码内 argv，落到 shell 命令必须引号成 `-gcflags 'all=-N -l'`）——写成
  // `-gcflags=all=-N -l` / `-gcflags all=-N -l` 会让 go 把 `-l` 解析成独立 flag 报错
  // （"unknown flag -l cannot be used with -c"）。
  return `go test -c -o ${shQuote(outRelPath)} -gcflags ${shQuote('all=-N -l')} ${shQuote(pkgDir)}`;
}

/**
 * 用例文件 → cargo target 锁定 flag（多目标工作区消歧，R4 对齐 RA/IDEA）：
 * 匹配任意前缀（项目根 / manifest 目录均可，如 `src-tauri/tests/…`）：
 * - `…/tests/<n>.rs` → `--test <n>`（integration）
 * - `…/src/bin/<n>.rs` | `…/src/bin/<n>/main.rs` → `--bin <n>`
 * - `…/src/main.rs` → 不锁定（crate root，单 bin 唯一候选；lib+bin 时 hint 精确对齐）
 * - 其余 `…/src/**` → 有 lib 则 `--lib`（lib 是 unit test 默认归宿），否则不锁定（单 bin）
 * - 未知布局 → 空串（不锁定，走解析器 hint/唯一候选兜底）
 * `hasLib` 由调用方探测 `src/lib.rs` 存在注入（纯函数，可单测）。
 */
export function resolveTestTargetFlag(filePath: string, hasLib: boolean): string {
  const p = filePath.replace(/\\/g, '/');
  const tests = p.match(/(?:^|\/)tests\/([^/]+)\.rs$/);
  if (tests) return `--test ${tests[1]}`;
  const binFile = p.match(/(?:^|\/)src\/bin\/([^/]+)\.rs$/);
  if (binFile) return `--bin ${binFile[1]}`;
  const binDir = p.match(/(?:^|\/)src\/bin\/([^/]+)\/main\.rs$/);
  if (binDir) return `--bin ${binDir[1]}`;
  if (/(?:^|\/)src\/main\.rs$/.test(p)) return '';
  if (/(?:^|\/)src\//.test(p)) return hasLib ? '--lib' : '';
  return '';
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
 * 解析 `cargo test --no-run --message-format=json` 输出中的单元测试二进制路径
 * （C4：结构化产物定位，替代正则猜 `Running|Executable unittests` 行）。
 *
 * 只消费 `reason:"compiler-artifact"` 且 `profile.test:true` 且 `executable`
 * 非空的行；其余（编译日志、`build-finished`、`compiler-message`、非法 JSON、
 * 非 test profile、executable 为空的 rlib/build-script 产物）全部丢弃。
 * `sourceHint` 为被编辑文件相对路径（如 `src/lib.rs`）：与 artifact 的
 * `target.src_path`（绝对路径）做后缀对齐，多二进制工作区中消歧。
 *
 * 输入清洗（防御性兜底，主路径输入已是干净管道 stdout）：逐行剥 ANSI 转义
 * 序列（颜色前缀）与 `\r` 行尾；截断产生的半行 JSON 解析失败即丢弃。
 *
 * 返回显式结果（§5 失败分类）：0 产物 → `binary_not_found`；多产物且 hint
 * 无法消歧到唯一 → `binary_ambiguous`（调用方显式落 DebugPanel console +
 * notification，不再静默 `return null`）。
 */
export type TestBinaryFailure = 'binary_not_found' | 'binary_ambiguous';
export type TestBinaryResult = { ok: true; path: string } | { ok: false; error: TestBinaryFailure };

interface CargoArtifactLine {
  reason?: string;
  target?: { src_path?: string };
  profile?: { test?: boolean };
  executable?: string | null;
}

/** ANSI 转义序列（CSI `ESC [ … <letter>`，如颜色 `\x1b[32m` / 复位 `\x1b[0m`）。
 *  `fromCharCode` 构造避免正则字面量里的控制字符（no-control-regex）。 */
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[A-Za-z]`, 'g');

/** 剥 ANSI 转义 + `\r` 行尾，返回可做 `startsWith('{')` 判定的干净行。 */
function cleanBuildLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r/g, '').trim();
}

export function parseTestBinaryPath(output: string, sourceHint?: string): TestBinaryResult {
  const candidates: Array<{ srcPath: string; binary: string }> = [];
  for (const line of output.split('\n')) {
    const trimmed = cleanBuildLine(line);
    if (!trimmed.startsWith('{')) continue; // 非 JSON 行丢弃（编译日志等）
    let value: CargoArtifactLine;
    try {
      value = JSON.parse(trimmed) as CargoArtifactLine;
    } catch {
      continue; // 非法 JSON 行丢弃（含截断半行）
    }
    if (value.reason !== 'compiler-artifact') continue;
    if (value.profile?.test !== true) continue;
    if (typeof value.executable !== 'string' || !value.executable) continue;
    candidates.push({ srcPath: value.target?.src_path ?? '', binary: value.executable });
  }
  if (candidates.length === 0) return { ok: false, error: 'binary_not_found' };
  if (sourceHint) {
    const matched = candidates.filter(
      (c) =>
        c.srcPath === sourceHint ||
        (c.srcPath !== '' && c.srcPath.endsWith(`/${sourceHint}`)) ||
        sourceHint.endsWith(`/${c.srcPath}`),
    );
    if (matched.length === 1) return { ok: true, path: matched[0].binary };
    if (matched.length > 1) return { ok: false, error: 'binary_ambiguous' };
    // hint 无匹配：唯一候选直接用，否则歧义（不猜多产物中的最后一个）。
    if (candidates.length === 1) return { ok: true, path: candidates[0].binary };
    return { ok: false, error: 'binary_ambiguous' };
  }
  if (candidates.length === 1) return { ok: true, path: candidates[0].binary };
  return { ok: false, error: 'binary_ambiguous' };
}

/** 相对二进制路径 → 绝对路径（cargo 在 cwd 下输出 `target/...` 相对路径）。 */
export function resolveBinaryPath(binary: string, cwd: string): string {
  if (binary.startsWith('/') || /^[A-Za-z]:[\\/]/.test(binary)) return binary;
  return `${cwd.replace(/[/\\]+$/, '')}/${binary}`;
}

/** 合成 debug launch 配置：program = 测试二进制，args = [name]（libtest 子串过滤，理由同 buildRunCommand）。
 *  Go：`type: 'go'` + `mode: 'exec'`（预编译测试二进制），args 传锚定 `-test.run` 模式
 *  （`^Name$`）——GoAdapter 端负责拼装 `-test.run` 前缀（见 go.rs），此处只传过滤模式本身。 */
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
  mode?: string;
  stopOnEntry: boolean;
} {
  if (testCase.lang === 'go') {
    return {
      name: `Debug test: ${testCase.name}`,
      type: 'go',
      request: 'launch',
      program,
      cwd: workspaceRoot,
      mode: 'exec',
      args: [`^${testCase.name}$`],
      stopOnEntry: false,
    };
  }
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
