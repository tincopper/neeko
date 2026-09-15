/**
 * Rust run/Debug 命令构造（纯函数；cargo 语义 + rust-analyzer runnable 载荷）。
 *
 * 从 `utils/testCommands.ts` 迁入（方案 B 阶段 2）：命令形态是**该语言的知识**，与
 * `discover.ts`（发现）、`manifest.ts`（清单探测）同住 `languages/rust/`。入参为语言私有
 * 选项（旧共享 `RunContext` 袋已消失）。
 */
import type { TestBinaryResult } from '../../exec/nativeBuild';
import { shellToken, shQuote } from '../../exec/shell';
import type { TestCaseInfo } from '../../syntax/contract';

import type { RustOverlay } from './runnables';

/**
 * Rust run/Debug 命令的入参（语言私有 —— 旧共享 `RunContext` 袋已不存在）。
 *
 * `manifestDir`：清单目录相对项目根（cargo 只向上查清单；根无 `Cargo.toml` 时必须显式
 * `--manifest-path`，否则 exit 101）。`lsp`：tier ① 的 rust-analyzer runnable（有则其
 * target 与过滤参数优先于本模块启发式）。
 */
export interface RustRunOptions {
  manifestDir: string | null;
  lsp?: RustOverlay | null;
}

/** caret 目标类型（与 `runnables/runnable.ts` 的 `RunnableTarget` 同形，避免反向依赖）。 */
export type LspTargetKind = 'test' | 'main';

/** LSP runnable → token 列表（`cargoArgs` 已在载荷内，无需再拼）。 */
function runnableCargoTokens(runnable: RustOverlay): string[] {
  return [runnable.args.overrideCargo || 'cargo', ...(runnable.args.cargoArgs ?? [])];
}

/**
 * LSP runnable → Rust **运行**命令。
 *
 * - `test`：保留本项目的**结构化结果流**参数（`-Z unstable-options --format=json --show-output`
 *   + `RUSTC_BOOTSTRAP=1`），否则 gutter 的 ✓/✗ 回填会失效；同时沿用 LSP 的完整测试路径与
 *   `--exact`（精度来源）。**刻意丢弃** RA 附带的 `--nocapture`（会把测试输出打到 stdout
 *   污染 JSON 行）与 `--include-ignored`（改变「显式忽略的用例是否执行」语义，与快路径不一致）。
 * - `main`：载荷就是 `cargo run --package …`，原样执行。
 */
export function buildRustRunnableRunCommand(runnable: RustOverlay, target: LspTargetKind): string {
  const tokens = runnableCargoTokens(runnable);
  if (target === 'main') return tokens.map(shellToken).join(' ');
  const executableArgs = runnable.args.executableArgs ?? [];
  const testPath = executableArgs.find((a) => !a.startsWith('-'));
  const libtestArgs = [
    ...(testPath ? [testPath] : []),
    ...(executableArgs.includes('--exact') ? ['--exact'] : []),
    '-Z',
    'unstable-options',
    '--format=json',
    '--show-output',
  ];
  return `RUSTC_BOOTSTRAP=1 ${[...tokens, '--', ...libtestArgs].map(shellToken).join(' ')}`;
}

/**
 * LSP runnable → Rust **无头构建**命令（Debug 前置）。
 *
 * `test`：沿用 LSP 的 target 选择 + `--no-run --message-format=json`（产物解析通道不变）；
 * `main`：LSP 给的是 `cargo run …`，把子命令换成 `build`（`cargo run` 本就会先构建，
 * 但 Debug 需要独立可执行产物 + artifact JSON）。
 */
export function buildRustRunnableBuildCommand(
  runnable: RustOverlay,
  target: LspTargetKind,
): string {
  const tokens = runnableCargoTokens(runnable) as [string, ...string[]];
  const [cargo, ...cargoArgs] = tokens;
  const sub = cargoArgs[0];
  const rest = cargoArgs.slice(1);
  const args =
    target === 'main'
      ? [...(sub === 'run' ? ['build'] : sub ? [sub] : []), ...rest]
      : [...(sub ? [sub] : []), ...rest, '--no-run'];
  return [cargo, ...args, '--message-format=json'].map(shellToken).join(' ');
}

/**
 * 各语言 run 命令（P1 结构化结果流版；**纯函数，无 lang 分支** —— 由注册表按
 * `testCase.lang` 选取）。命令形态：
 * - Rust `RUSTC_BOOTSTRAP=1 cargo test <name>[ --manifest-path …] -- -Z unstable-options
 *   --format=json --show-output`（libtest JSON 行，env 前缀与 Windows 限制见文件头）。
 * - Go `go test -run '^Name$' -json <pkg>`（test2json 行式事件，与 libtest 同族）。
 * - Java JUnit Console Launcher（只传 `-m` 方法选择器；`--class-path` 见 buildJavaClasspath）。
 * - TS `pnpm vitest run <relPath> -t <name>` + default/json 双 reporter。
 *
 * `manifestDir`：清单所在目录相对项目根（cargo 只向上查清单，项目根无
 * `Cargo.toml` 时必须显式 `--manifest-path`，否则 exit 101）。
 * `runRoot`：TS 报告路径的 run 根；为空回退相对路径。
 *
 * 不用 `--exact`：libtest exact 匹配完整测试路径，仅传 fn 名时 `mod tests`
 * 嵌套用例匹配 0 个；子串过滤对根级/嵌套均命中（MVP，模块路径透传待后续）。
 */
export function buildRustRunCommand(testCase: TestCaseInfo, opts: RustRunOptions): string {
  // tier ①：LSP（rust-analyzer `experimental/runnables`）给出的确定性参数 —— 含
  // `--package` / `--bin` 与**完整测试路径 + `--exact`**，无需再猜清单与 target。
  if (opts.lsp) return buildRustRunnableRunCommand(opts.lsp, 'test');
  return (
    `RUSTC_BOOTSTRAP=1 cargo test ${shQuote(testCase.name)}` +
    `${buildManifestArgs(opts.manifestDir)} -- -Z unstable-options --format=json --show-output`
  );
}

/** `--manifest-path '<dir>/Cargo.toml'`（有目录提示时）；否则空串。 */
function buildManifestArgs(manifestDir?: string | null): string {
  if (!manifestDir) return '';
  return ` --manifest-path ${shQuote(`${manifestDir.replace(/[/\\]+$/, '')}/Cargo.toml`)}`;
}

export function buildRustMainRunCommand(opts: RustRunOptions): string {
  // tier ①：LSP 的 `cargo run --package X [--bin Y]` —— 多 bin 工作区不再靠 cargo 报错提示。
  if (opts.lsp) return buildRustRunnableRunCommand(opts.lsp, 'main');
  return `cargo run${buildManifestArgs(opts.manifestDir)}`;
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
  manifestDir?: string | null,
  targetFlag = '',
  lsp?: RustOverlay | null,
): string {
  if (testCase.lang !== 'rust') {
    throw new Error(`Debug is only supported for Rust tests, got: ${testCase.lang}`);
  }
  // tier ①：LSP 的 target 选择（`cargo test --package X --bin Y`）—— 多 target 工作区里
  // 产物谓词唯一，不再依赖 targetFlag 猜测与 sourceHint 消歧。
  if (lsp) return buildRustRunnableBuildCommand(lsp, 'test');
  const target = targetFlag ? ` ${targetFlag}` : '';
  return `cargo test ${shQuote(testCase.name)} --no-run${target}${buildManifestArgs(manifestDir)} --message-format=json`;
}

export function buildRustMainDebugBuildCommand(opts: RustRunOptions): string {
  // tier ①：LSP 的 target 选择（`cargo run --package X [--bin Y]`）换成 `build`——
  // 多 bin 工作区里产物谓词唯一，无需再靠 sourceHint 消歧。
  if (opts.lsp) return buildRustRunnableBuildCommand(opts.lsp, 'main');
  return `cargo build${buildManifestArgs(opts.manifestDir)} --message-format=json`;
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
interface CargoArtifactLine {
  reason?: string;
  target?: { src_path?: string };
  profile?: { test?: boolean };
  executable?: string | null;
}

/** ANSI 转义序列（CSI `ESC [ … <letter>`，如颜色 `\x1b[32m` / 复位 `\x1b[0m`）。
 *  `fromCharCode` 构造避免正则字面量里的控制字符（no-control-regex）。 */
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[A-Za-z]`, 'g');

/** 从 compiler-artifact 候选中按 sourceHint 消歧到唯一二进制（测试/ main 共用）。 */
function pickBinary(
  candidates: Array<{ srcPath: string; binary: string }>,
  sourceHint?: string,
): TestBinaryResult {
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

/** 剥 ANSI 转义 + `\r` 行尾，返回可做 `startsWith('{')` 判定的干净行。 */
function cleanBuildLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r/g, '').trim();
}

/** 收集 cargo `--message-format=json` 输出中的可执行产物候选（按 predicate 过滤）。 */
function collectCargoBinaries(
  output: string,
  keep: (line: CargoArtifactLine) => boolean,
): Array<{ srcPath: string; binary: string }> {
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
    if (!keep(value)) continue;
    if (typeof value.executable !== 'string' || !value.executable) continue;
    candidates.push({ srcPath: value.target?.src_path ?? '', binary: value.executable });
  }
  return candidates;
}

export function parseTestBinaryPath(output: string, sourceHint?: string): TestBinaryResult {
  const candidates = collectCargoBinaries(output, (value) => value.profile?.test === true);
  return pickBinary(candidates, sourceHint);
}

/**
 * 解析 `cargo build --message-format=json` 输出中的 main 二进制路径。
 * 与 `parseTestBinaryPath` 同族，但取**非 test profile** 的可执行产物（main bin），
 * 按 `sourceHint`（被编辑文件）后缀对齐消歧——多 bin 工作区下选对文件所属 bin。
 */
export function parseCargoBinaryPath(output: string, sourceHint?: string): TestBinaryResult {
  const candidates = collectCargoBinaries(output, (value) => value.profile?.test !== true);
  return pickBinary(candidates, sourceHint);
}

/** 相对二进制路径 → 绝对路径（cargo 在 cwd 下输出 `target/...` 相对路径）。 */
export function resolveBinaryPath(binary: string, cwd: string): string {
  if (binary.startsWith('/') || /^[A-Za-z]:[\\/]/.test(binary)) return binary;
  return `${cwd.replace(/[/\\]+$/, '')}/${binary}`;
}
