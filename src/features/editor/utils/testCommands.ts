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
import { relativeToRoot } from '@/shared/utils/fileRef';

import type { LspRunnable } from '../runnables/runnable';

import type { ExistsProbe } from './cargoManifest';
import type { TestCaseInfo } from './testCases';

/** 绝对路径判定（POSIX `/` 或 Windows 盘符）；用于识别「无法表达为 cwd 相对」的输入。 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * 被编辑文件路径 → runRoot 相对分段。
 *
 * 生产链路（FileEditor → useRunActions）传入 `tab.filePath` —— 恒为 canonical 绝对
 * 路径；单测传入相对路径。本模块的清单/module 探测以「runRoot 相对」为逐级拼接
 * 前提（`${root}/${dir}`），不归一化时绝对路径会拼成 `${root}//abs/…`，探测永不
 * 命中且回退产出 `./abs/…` 伪包路径（go run / go build 秒失败）。
 * 归一化统一走 `relativeToRoot`（fileRef 是路径形态换算的唯一所有权模块）。
 */
function runRootRelativeParts(filePath: string, runRoot: string): string[] {
  return relativeToRoot(runRoot, filePath).split('/');
}

/** POSIX 单引号转义：内嵌 `'` → `'\''`。 */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 按需引用（shlex 风格）：仅当 token 含**不安全字符**时才 `shQuote`。
 *
 * 命令要显示在 Task Console 且可复制 —— 全量引用（`'cargo' 'test' '--package'`）虽正确但
 * 不可读；RA 来的 token 多为 flag / 路径，绝大多数无需引用。安全集与 Python `shlex.quote`
 * 一致（字母数字 + `@%+=:,./-`），因此 `::`（Rust 测试路径）、`=`（`-gcflags=all=-N -l` 类）
 * 均不引用；含空格 / 引号 / shell 元字符的一律单引号包裹。
 */
export function shellToken(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(token) && token !== '' ? token : shQuote(token);
}

// ── tier ①：LSP runnable → 命令（Rust / rust-analyzer）─────────────────────────

/** caret 目标类型（与 `runnables/runnable.ts` 的 `RunnableTarget` 同形，避免反向依赖）。 */
export type LspTargetKind = 'test' | 'main';

/** LSP runnable → token 列表（`cargoArgs` 已在载荷内，无需再拼）。 */
function runnableCargoTokens(runnable: LspRunnable): string[] {
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
export function buildRustRunnableRunCommand(runnable: LspRunnable, target: LspTargetKind): string {
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
  runnable: LspRunnable,
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

/** vitest JSON 报告的 run 根下相对路径（读取侧与命令侧共用同一常量，保证路径一致）。 */
export const VITEST_REPORT_REL_PATH = 'node_modules/.neeko/vitest-report.json';

/** vitest JSON 报告绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildVitestReportPath(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${VITEST_REPORT_REL_PATH}` : VITEST_REPORT_REL_PATH;
}

/** JUnit XML 报告目录（run 根相对，读取侧与命令侧共用同一常量，保证路径一致）。 */
export const JUNIT_REPORTS_REL_PATH = '.neeko/junit-reports';

/** JUnit XML 报告目录绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildJunitReportsDir(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${JUNIT_REPORTS_REL_PATH}` : JUNIT_REPORTS_REL_PATH;
}

/**
 * Java 测试类全限定名（FQCN）推导：
 * `src/test/java/<pkg>/<Name>.java` → `<pkg>.<Name>`；
 * `src/main/java/<pkg>/<Name>.java` → `<pkg>.<Name>`（学习工程常用布局）；
 * 文件直接位于源根下（默认包边界）→ `<Name>`；
 * 定位不到标准源根时按目录层级回退（去 `.java` + `/`→`.`）。
 */
export function deriveJavaFqcn(filePath: string): string {
  const p = filePath.replace(/\\/g, '/').replace(/\.java$/i, '');
  // 标准源根按优先级剥离（与宿主 SimpleSourceLookUpProvider.resolveClassName 对齐）：
  // 测试类通常在 src/test/java，但也有项目（如学习工程）把用例直接放 src/main/java。
  for (const marker of ['src/test/java/', 'src/main/java/']) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      return p
        .slice(idx + marker.length)
        .split('/')
        .filter((s) => s.length > 0)
        .join('.');
    }
  }
  const body = p;
  return body
    .split('/')
    .filter((s) => s.length > 0)
    .join('.');
}

/**
 * Maven `dependency:build-classpath` 输出文件相对路径（run 根，gitignored `.neeko/` 下）。
 * 读取侧与命令侧共用同一常量，保证路径一致。
 */
export const MAVEN_CLASSPATH_REL_PATH = '.neeko/java-classpath.txt';

/** Maven 依赖 classpath 输出文件绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildMavenClasspathPath(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${MAVEN_CLASSPATH_REL_PATH}` : MAVEN_CLASSPATH_REL_PATH;
}

/**
 * Maven 依赖 classpath 解析命令（resolveJavaClasspath 的命令构造侧）：
 * `mvn dependency:build-classpath -Dmdep.outputFile=<f>`。
 * MVP 单模块（pom.xml 在 run 根）；Gradle 等价任务后续。
 * `dependency:build-classpath` 的 `includeScope` 默认 test（单测依赖即可达，无需显式传参）。
 */
export function buildMavenClasspathCommand(runRoot: string): string {
  return `mvn dependency:build-classpath -Dmdep.outputFile=${shQuote(buildMavenClasspathPath(runRoot))}`;
}

/**
 * 解析 `mvn dependency:build-classpath` 输出文件内容 → classpath 字符串
 * （resolveJavaClasspath 的输出解析侧）。输出文件为单行（`:` 分隔的依赖 jar 绝对路径）；
 * 剥首尾空白与空行，多行时以 `:` 归并（防御性兜底，主路径输入已是单行）。
 */
export function parseClasspathOutput(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(':');
}

// ── Java 运行 classpath + launcher 供给 ─────────────────────────────────────

/**
 * JUnit Platform Console Launcher 版本（research/test-debug-java.md §2.1：
 * 固定 1.x 线 —— Java 8+ 运行时下限比 6.x（Java 17+）更宽；1.14.4 为 1.x 最新稳定）。
 */
export const JUNIT_CONSOLE_LAUNCHER_VERSION = '1.14.4';

/** launcher jar 文件名（如 `junit-platform-console-standalone-1.14.4.jar`）。 */
export function junitLauncherJarName(version = JUNIT_CONSOLE_LAUNCHER_VERSION): string {
  return `junit-platform-console-standalone-${version}.jar`;
}

/**
 * launcher jar 供给路径：`<home>/.neeko/<jar>`（Neeko 全局缓存惯例，与 java-host
 * 同根）。jar 缺失时由调用方提示下载（research §2.1 Maven Central URL），首次运行
 * 需网络下载一次，之后幂等复用。
 * home 未知时回退 bare 文件名（cwd 下查找，兼容用户自备 jar / 手动放置）。
 */
export function buildJavaLauncherPath(home: string | null | undefined): string {
  return home ? `${home}/.neeko/${junitLauncherJarName()}` : junitLauncherJarName();
}

/**
 * Java classpath **条目**（未拼接形态）：`<root>/target/classes`、
 * `<root>/target/test-classes`、其后接 Maven 依赖条目。
 *
 * `buildJavaClasspath` 的拼接串只能交给 `--class-path`；调试链路还需要逐条
 * classpath（host 侧据此解析第三方库 / JDK 源码），故在此分流 —— 分隔符语义
 * 与拼接同源（`:`），`deps` 已在 `parseClasspathOutput` 归一（无空条目）。
 */
export function buildJavaClasspathEntries(runRoot: string, deps = ''): string[] {
  const base = runRoot ? `${runRoot}/` : '';
  const entries = [`${base}target/classes`, `${base}target/test-classes`];
  if (deps) entries.push(...deps.split(':').filter((entry) => entry.length > 0));
  return entries;
}

/**
 * Java 测试运行时 classpath：`<root>/target/classes:<root>/target/test-classes[:<deps>]`。
 * deps 为 `mvn dependency:build-classpath` 产物（.neeko/java-classpath.txt，
 * parseClasspathOutput 解析）；Maven 自编译输出目录手工前置拼接（research §3.1：
 * build-classpath 只输出依赖 jar，不含项目自身 classes 输出）。
 * run 根空时回退相对 `target/` 目录（命令 cwd 即 run 根，Shell 通道均成立）。
 *
 * 关键约束：`java -jar` 下 JVM **忽略命令行 `-cp`**，项目 classpath 只能经 Console
 * Launcher 自身的 `--class-path` 选项传入（research §2.2/§2.4）——这是 Java 测试
 * 类能加载的前提。
 */
export function buildJavaClasspath(runRoot: string, deps = ''): string {
  return buildJavaClasspathEntries(runRoot, deps).join(':');
}

/** 文本读取探针：java 分支读取 Maven classpath 产物；返回 null 表示缺失/读取失败。 */
export type ReadTextProbe = (absPath: string) => Promise<string | null>;

/**
 * Java 运行环境注入（buildRunCommand / buildJavaDebugCommand 的 java 分支）：
 * - `launcherPath`：Console Launcher jar 绝对路径（缺失回退 bare 文件名）；
 * - `readText`：读取 `mvn dependency:build-classpath` 产物（.neeko/java-classpath.txt）
 *   的探针（调用方 bind projectId）；缺失时 deps 为空 → classpath 仅含 target/ 输出目录。
 */
export interface JavaRunEnv {
  launcherPath?: string;
  readText?: ReadTextProbe;
}

/**
 * 解析 Maven 依赖 classpath：读 `.neeko/java-classpath.txt`（buildMavenClasspathPath）
 * → parseClasspathOutput。文件缺失/读取失败返回 ''（退化为仅 target/ 目录 classpath）。
 */
export async function resolveJavaClasspath(
  runRoot: string,
  readText: ReadTextProbe,
): Promise<string> {
  const text = await readText(buildMavenClasspathPath(runRoot));
  if (!text) return '';
  return parseClasspathOutput(text);
}

/** Java 模块标记文件（Maven 优先，Gradle 两种 DSL 次之）。 */
const JAVA_MODULE_MARKERS = ['pom.xml', 'build.gradle.kts', 'build.gradle'];

/** Tauri `file_exists` 默认探针（与 goExists 同构）。 */
const javaExists: ExistsProbe = (absPath) => fileExists(absPath);

/**
 * Java 模块根探测：从被编辑文件目录向上找最近的模块标记（`pom.xml` /
 * `build.gradle[.kts]`），返回相对 `runRoot` 的模块目录；找不到/探测失败 → null。
 * 与 `findGoModuleDir` 同构 —— 多模块 Maven/Gradle 工程（如聚合根下 `learning-algorithm/`）
 * 必须按模块根拼 classpath（`target/classes` 按模块输出），按项目根拼则 ClassNotFound。
 *
 * - 根模块：标记在 runRoot → 返回 `''`（模块根 = runRoot）。
 * - 嵌套模块：标记在某子目录（如 `learning-algorithm/`）→ 返回该相对目录。
 */
export async function findJavaModuleDir(
  filePath: string,
  runRoot: string,
  probe: ExistsProbe = javaExists,
): Promise<string | null> {
  const root = runRoot.replace(/[/\\]+$/, '');
  if (!root || !filePath) return null;
  const parts = runRootRelativeParts(filePath, root);
  parts.pop(); // 去掉文件名，从所在目录起向上
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/'); // '' = runRoot 自身
    const base = dir ? `${root}/${dir}` : root;
    for (const marker of JAVA_MODULE_MARKERS) {
      try {
        if (await probe(`${base}/${marker}`)) return dir;
      } catch {
        return null; // 探测失败（IPC 不可用等）→ 回退，不阻塞运行
      }
    }
  }
  return null;
}

/**
 * Java 用例类编译产物存在性：按 Maven（`target/classes|test-classes`）与 Gradle
 *（`build/classes/java/{main,test}`）标准输出目录找 `<FQCN>.class`。
 * 任一命中 → true；均缺失/探测失败 → false（调用方据此提示先编译，不阻塞为原则，
 * 故探测异常按缺失处理，由调用方决定是否阻断）。
 */
export async function javaCompiledClassExists(
  moduleRoot: string,
  fqcn: string,
  probe: ExistsProbe = javaExists,
): Promise<boolean> {
  if (!moduleRoot || !fqcn) return false;
  const base = moduleRoot.replace(/[/\\]+$/, '');
  const rel = `${fqcn.replace(/\./g, '/')}.class`;
  const candidates = [
    `${base}/target/classes/${rel}`,
    `${base}/target/test-classes/${rel}`,
    `${base}/build/classes/java/main/${rel}`,
    `${base}/build/classes/java/test/${rel}`,
  ];
  for (const c of candidates) {
    try {
      if (await probe(c)) return true;
    } catch {
      return false;
    }
  }
  return false;
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
  const parts = runRootRelativeParts(filePath, root);
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
 * 文件所在目录。`filePath` 允许 canonical 绝对或 runRoot 相对（统一归一化）。
 */
export async function goPkgDir(
  filePath: string,
  runRoot?: string | null,
  probe: ExistsProbe = goExists,
): Promise<string> {
  const rel = runRoot ? relativeToRoot(runRoot, filePath) : filePath.replace(/\\/g, '/');
  if (runRoot && !isAbsolutePath(rel)) {
    const moduleDir = await findGoModuleDir(rel, runRoot, probe);
    if (moduleDir !== null) {
      const pkg = pkgDirRelativeToModule(rel, moduleDir);
      return pkg ? `./${pkg}` : '.';
    }
  }
  // 回退：文件所在目录（`./dir` / `.` 为 cwd 相对）。文件在 runRoot 之外时无法
  // 表达为 cwd 相对 —— 兜底 cwd，不产出 `./abs/…` 假包路径。
  if (isAbsolutePath(rel)) return '.';
  const lastSlash = rel.lastIndexOf('/');
  const dir = lastSlash >= 0 ? rel.slice(0, lastSlash) : '';
  return dir ? `./${dir}` : '.';
}

/**
 * 命令构造所需的「已解析环境事实」。
 *
 * 此前 `buildRunCommand` 等标称纯函数却在内部 `await`（Go 用 `goPkgDir` 探测
 * go.mod、Java 读 Maven classpath 产物），既不能脱离 IO 单测，也无法在同一次
 * run 内复用。现把全部 IO 收拢到 [`resolveRunContext`]（async，可缓存），
 * 各 `build*Command` 一律纯函数，只吃本结构。
 */
export interface RunContext {
  /** Go：测试/main 文件所属包目录（cwd 相对 `./dir` / `.`）。 */
  readonly goPkg: string;
  /** Java：Maven 依赖 classpath（`''` → 退化为仅 target/ 输出目录）。 */
  readonly javaDeps: string;
  /** Java：Console Launcher jar（绝对路径或 bare 文件名）。 */
  readonly javaLauncher: string;
}

/** 零 IO 的默认上下文（非 Go/Java 语言，或缺省探针）。 */
export function defaultRunContext(): RunContext {
  return { goPkg: '.', javaDeps: '', javaLauncher: junitLauncherJarName() };
}

// 环境事实的**表驱动**解析在 `runLanguages.ts`（`RunLanguage.resolveContext`
// 注册项 + `resolveRunContext`）——本模块只保留 `RunContext` 形状、默认上下文与
// 各语言纯构造器，不再持有 lang 分发分支。注册表单向依赖本模块的 IO 原语
// （`goPkgDir` / `resolveJavaClasspath`），无循环。

/** run 命令构造输入（各语言解构自取所需字段）。 */
export interface RunCommandInput {
  testCase: TestCaseInfo;
  relPath: string;
  cargoManifestDir: string | null | undefined;
  runRoot: string | null | undefined;
  ctx: RunContext;
  /** tier ①：LSP 给出的确定性 runnable（有则优先于本模块的启发式）。 */
  lsp?: LspRunnable | null;
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
 * `cargoManifestDir`：清单所在目录相对项目根（cargo 只向上查清单，项目根无
 * `Cargo.toml` 时必须显式 `--manifest-path`，否则 exit 101）。
 * `runRoot`：TS 报告路径的 run 根；为空回退相对路径。
 *
 * 不用 `--exact`：libtest exact 匹配完整测试路径，仅传 fn 名时 `mod tests`
 * 嵌套用例匹配 0 个；子串过滤对根级/嵌套均命中（MVP，模块路径透传待后续）。
 */
export function buildRustRunCommand({ testCase, cargoManifestDir, lsp }: RunCommandInput): string {
  // tier ①：LSP（rust-analyzer `experimental/runnables`）给出的确定性参数 —— 含
  // `--package` / `--bin` 与**完整测试路径 + `--exact`**，无需再猜清单与 target。
  if (lsp) return buildRustRunnableRunCommand(lsp, 'test');
  return (
    `RUSTC_BOOTSTRAP=1 cargo test ${shQuote(testCase.name)}` +
    `${buildManifestArgs(cargoManifestDir)} -- -Z unstable-options --format=json --show-output`
  );
}

/** Go 正则元字符（RE2 语法）—— 段内出现任一即需 `\Q…\E` 原样引用。 */
const GO_PATTERN_META = /[\\^$.|?*+()[\]{}]/;

/** 单个 `-run` 层级段锚定：裸标识符 → `^Name$`；含元字符 → `^\QName\E$`。 */
function anchorGoPatternSegment(segment: string): string {
  return GO_PATTERN_META.test(segment) ? `^\\Q${segment}\\E$` : `^${segment}$`;
}

/**
 * Go `-run` / `-test.run` 的**层级锚定模式**（GoLand 同款 `^\QTestAdd\E$/^\Qsub\E$`）。
 *
 * Go 的 `-run` 语义：先按 `/` 切分层级，再**逐层做正则匹配**（每层独立锚定）。`t.Run`
 * 的子测试名是任意字符串（可含 `.` `+` `|` 等元字符）—— 实测未引用时 `^a+b$` 匹配不到
 * 字面量 `a+b`，故含元字符的段必须 `\Q…\E` 原样引用。顶层用例名是 Go 标识符
 * （`[A-Za-z0-9_]`，无元字符），走 `^Name$`，与既有命令形态**逐字节一致**。
 *
 * Run（`-run`）与 Debug（delve `-test.run`）共用本函数，避免两条链路各自拼装而漂移
 * （同 Rust `languageSyntax` 单一事实源的教训）。已知边界（与 GoLand 同）：名字段若
 * 字面含 `\E` 会提前结束引用（未处理，实际用例名不可能出现）。
 */
export function goTestRunPattern(name: string): string {
  return name.split('/').map(anchorGoPatternSegment).join('/');
}

/** Go：`-run` 锚定 `^Name$`（子串命中会多跑；debug 0 命中则断点永不触发）。 */
export function buildGoRunCommand({ testCase, ctx }: RunCommandInput): string {
  const pkg = shQuote(ctx.goPkg);
  const runPattern = shQuote(goTestRunPattern(testCase.name));
  // 基准：`-run '^$'` 关掉用例、`-bench` 锚定基准名、`-count=1` **禁缓存** ——
  // 缓存命中时 go 只回包级事件（无 benchmark 输出/`run` 事件），会被「零命中告警」误判。
  if (testCase.kind === 'benchmark') {
    return `go test -run ${shQuote('^$')} -bench ${runPattern} -count=1 -json ${pkg}`;
  }
  return `go test -run ${runPattern} -json ${pkg}`;
}

/**
 * Java 用例的 JUnit 方法选择器：`<FQCN>[<$内层类…>]#<method>`。
 *
 * `@Nested` 内层类**必须**用 `$` 连接 —— 真机实证（design §7.7.1）：
 * `com.example.AppTest#testNested` 会报
 * `PreconditionViolationException: Could not find method with name [testNested] in class [com.example.AppTest]`，
 * 而 `com.example.AppTest$InnerCases#testNested` 正确执行 1 个用例。
 * `nestedClassPath` 缺省 / 空 → 与历史形态**逐字节一致**（Run 与 Debug 共用本函数，防两条链路漂移）。
 */
export function javaMethodSelector(fqcn: string, testCase: TestCaseInfo): string {
  const nested = (testCase.nestedClassPath ?? []).map((name) => `$${name}`).join('');
  return `${fqcn}${nested}#${testCase.name}`;
}

/** Java：只传 `-m <FQCN#method>`（`-c` 与 `-m` 是 OR 语义，同传会跑整类）。
 *  `--class-path` = target/ 输出 + Maven 依赖产物（ctx.javaDeps）；launcher 取 ctx。 */
export function buildJavaRunCommand({ testCase, relPath, runRoot, ctx }: RunCommandInput): string {
  const fqcn = deriveJavaFqcn(relPath);
  const cp = buildJavaClasspath(runRoot ?? '', ctx.javaDeps);
  return (
    `java -jar ${shQuote(ctx.javaLauncher)} --class-path=${shQuote(cp)}` +
    ` -m ${shQuote(javaMethodSelector(fqcn, testCase))} --reports-dir=${shQuote(buildJunitReportsDir(runRoot ?? ''))}`
  );
}

/** TS/JS：default reporter 进 Task Console，json 落文件供 onExit 读取。 */
export function buildTsRunCommand({ testCase, relPath, runRoot }: RunCommandInput): string {
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

/** main run 命令构造输入（各语言解构自取）。 */
export interface MainRunInput {
  filePath: string;
  runRoot: string;
  manifestDir: string | null | undefined;
  ctx: RunContext;
  /** tier ①：LSP 给出的确定性 runnable（有则优先于本模块的启发式）。 */
  lsp?: LspRunnable | null;
}

/**
 * 各语言 main 入口运行命令（gutter main-run 按钮消费；run-only，Debug 走
 * DebugRunButton；**纯函数，无 lang 分支** —— 注册表按语言选取）：
 * - Go `go run <pkg>`（module 感知包目录，见 ctx.goPkg）；
 * - Rust `cargo run[ --manifest-path …]`（workspace 多 bin 歧义由 cargo 报错提示，声明局限）；
 * - Java `java -cp <cp> <FQCN>`（classpath 同 Run；调用前须过编译产物预检）。
 */
export function buildGoMainRunCommand({ ctx }: MainRunInput): string {
  return `go run ${shQuote(ctx.goPkg || '.')}`;
}

export function buildRustMainRunCommand({ manifestDir, lsp }: MainRunInput): string {
  // tier ①：LSP 的 `cargo run --package X [--bin Y]` —— 多 bin 工作区不再靠 cargo 报错提示。
  if (lsp) return buildRustRunnableRunCommand(lsp, 'main');
  return `cargo run${buildManifestArgs(manifestDir)}`;
}

export function buildJavaMainRunCommand({ filePath, runRoot, ctx }: MainRunInput): string {
  const fqcn = deriveJavaFqcn(filePath);
  const cp = buildJavaClasspath(runRoot ?? '', ctx.javaDeps);
  return `java -cp ${shQuote(cp)} ${fqcn}`;
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
  lsp?: LspRunnable | null,
): string {
  if (testCase.lang !== 'rust') {
    throw new Error(`Debug is only supported for Rust tests, got: ${testCase.lang}`);
  }
  // tier ①：LSP 的 target 选择（`cargo test --package X --bin Y`）—— 多 target 工作区里
  // 产物谓词唯一，不再依赖 targetFlag 猜测与 sourceHint 消歧。
  if (lsp) return buildRustRunnableBuildCommand(lsp, 'test');
  const target = targetFlag ? ` ${targetFlag}` : '';
  return `cargo test ${shQuote(testCase.name)} --no-run${target}${buildManifestArgs(cargoManifestDir)} --message-format=json`;
}

/** FNV-1a 32 位（8 位 hex）—— 仅作产物文件名去重，非安全用途。 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Go Debug 前置构建产物相对路径（cwd 相对，gitignored `.neeko/` 下）。
 * `go test -c -o` 会自建父目录；产物路径显式（`-o`），启动时按此解析，无 compiler-artifact。
 *
 * `name` 可能是**子测试全名**（P3 动态子测试，`<父>/<层级>`）而 `t.Run` 的名字是任意字符串 →
 * 不能直接当文件名：
 * - `/` 会让产物落到嵌套目录（实测 go 自建父目录、能编译，但把 `.neeko/test-bin` 撑成树）；
 * - Windows 保留字符 `: * ? " < > |` 会让 `-o` 直接失败（本机 macOS/Linux 合法，故本地开发
 *   不暴露、跨平台才炸）。
 *
 * 策略：不安全字符 → `_`；**仅当发生过替换**时追加原名哈希后缀 —— 否则 `TestTable/zero` 与
 * `TestTable_zero` 会清洗成同一个文件名，后者构建覆盖前者的二进制，调试时挂错 target。
 * 顶层用例名是 Go 标识符（无替换）→ 产物名与既有 `.neeko/test-bin/<name>` **逐字节一致**。
 */
export function goDebugBinaryRelPath(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe === name ? `.neeko/test-bin/${name}` : `.neeko/test-bin/${safe}-${shortHash(name)}`;
}

/**
 * Java Debug 前置命令（J3 attach-first，与 Run 命令同源、仅注入 jdwp 参数）：
 * `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0
 *  -jar <launcher> --class-path=<cp> -m '<FQCN#method>'
 *  --reports-dir=<dir>`
 *
 * - `-agentlib:jdwp=…,server=y,suspend=y,address=0`：JVM 自选空闲 jdwp 端口并在
 *   main 前挂起（等 DAP attach），stdout 打印 `Listening for transport dt_socket
 *   at address: <port>` —— Rust `debug_java_attach` 解析该端口。
 * - 用例过滤与 Run 完全一致（只传 `-m` 方法选择器，FQCN 同 `deriveJavaFqcn`）；
 *   `--reports-dir` 保留：调试结束后 JUnit XML 状态流仍可回填 gutter。
 * - `--class-path` 与 Run 同源（buildJavaClasspath：target/ 输出 + Maven 依赖产物）——
 *   attach 模式下 JDI 连已运行 JVM 后按 classpath 定位源码/类；`java -jar` 下
 *   JVM 忽略 `-cp`，只能经 Console Launcher `--class-path` 传入。
…
 */

/**
 * Java main Debug 前置命令（attach-first，与测试仅差「无选择器」）：
 * `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0
 *  -cp <cp> <FQCN>` —— 直接跑应用 main，JVM 挂到 attach 后才执行。
 */
export function buildMainJavaDebugCommand(
  filePath: string,
  runRoot: string,
  ctx: RunContext,
): string {
  const fqcn = deriveJavaFqcn(filePath);
  const cp = buildJavaClasspath(runRoot ?? '', ctx.javaDeps);
  return (
    `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0` +
    ` -cp ${shQuote(cp)} ${fqcn}`
  );
}

/** main Debug 前置构建输入（各语言解构自取）。 */
export interface MainDebugBuildInput {
  manifestDir: string | null | undefined;
  ctx: RunContext;
  /** tier ①：LSP 给出的确定性 runnable（有则优先于本模块的启发式）。 */
  lsp?: LspRunnable | null;
}

/**
 * 各语言 main Debug 前置构建命令（**纯函数，无 lang 分支** —— 注册表按语言选取）：
 * - Go `go build -o <out> -gcflags 'all=-N -l' <pkg>`（无优化构建是 dlv 断点/变量
 *   正确性前提；`-o` 显式产物路径，启动时按此解析，无 compiler-artifact）；
 * - Rust `cargo build[ --manifest-path …] --message-format=json`（bin 产物由
 *   `parseCargoBinaryPath` 解析；多 bin 工作区按 sourceHint=被编辑文件消歧）。
 */
export function buildGoMainDebugBuildCommand({ ctx }: MainDebugBuildInput): string {
  const outRel = goDebugBinaryRelPath('main');
  return `go build -o ${shQuote(outRel)} -gcflags ${shQuote('all=-N -l')} ${shQuote(ctx.goPkg || '.')}`;
}

export function buildRustMainDebugBuildCommand({ manifestDir, lsp }: MainDebugBuildInput): string {
  // tier ①：LSP 的 target 选择（`cargo run --package X [--bin Y]`）换成 `build`——
  // 多 bin 工作区里产物谓词唯一，无需再靠 sourceHint 消歧。
  if (lsp) return buildRustRunnableBuildCommand(lsp, 'main');
  return `cargo build${buildManifestArgs(manifestDir)} --message-format=json`;
}

/** Debug launch 配置（测试/main 共用形状，与 debugStore.LaunchConfig 兼容）。 */
export interface NativeDebugLaunchConfig {
  name: string;
  type: string;
  request: string;
  program: string;
  cwd: string;
  args: string[];
  mode?: string;
  stopOnEntry: boolean;
}

/** 合成 main Debug launch 配置：program = 构建产物，args = []（无测试过滤）。
 *  Go `type:'go'`+`mode:'exec'`（预编译 main 二进制，dlv exec）；Rust `type:'lldb'`。 */
export function buildMainDebugLaunchConfig(
  lang: 'go' | 'rust',
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  if (lang === 'go') {
    return {
      name: 'Debug main',
      type: 'go',
      request: 'launch',
      program,
      cwd: workspaceRoot,
      mode: 'exec',
      args: [],
      stopOnEntry: false,
    };
  }
  return {
    name: 'Debug main',
    type: 'lldb',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    args: [],
    stopOnEntry: false,
  };
}
/**
 * Java 测试 Debug 前置命令（J3 attach-first，与 Run 命令同源、仅注入 jdwp 参数）：
 * `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0
 *  -jar <launcher> --class-path=<cp> -m '<FQCN#method>' --reports-dir=<dir>`
 * launcher jar 走 ~/.neeko/ 缓存供给（buildJavaLauncherPath），`javaEnv` 注入路径
 * 与 classpath 读取探针（同 buildRunCommand）。
 */
export function buildJavaDebugCommand(
  testCase: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
  ctx: RunContext,
): string {
  const fqcn = deriveJavaFqcn(relPath);
  const cp = buildJavaClasspath(runRoot ?? '', ctx.javaDeps);
  return (
    `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0` +
    ` -jar ${shQuote(ctx.javaLauncher)} --class-path=${shQuote(cp)}` +
    ` -m ${shQuote(javaMethodSelector(fqcn, testCase))} --reports-dir=${shQuote(buildJunitReportsDir(runRoot ?? ''))}`
  );
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

/** 合成 debug launch 配置：program = 测试二进制，args = [name]（libtest 子串过滤，理由同 buildRunCommand）。
 *  Go：`type: 'go'` + `mode: 'exec'`（预编译测试二进制），args 传锚定 `-test.run` 模式
 *  （`goTestRunPattern`）——GoAdapter 端负责拼装 `-test.run` 前缀（见 go.rs），此处只传过滤模式本身。 */
export function buildDebugLaunchConfig(
  testCase: TestCaseInfo,
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  if (testCase.lang === 'go') {
    // 基准：显式传全量 delve flag（首参以 `-` 开头 → GoAdapter 原样透传，不再拼 `-test.run`），
    // 否则会退化成「跑用例」而非「跑基准」。用例：裸锚定模式，adapter 负责拼 `-test.run`。
    const isBenchmark = testCase.kind === 'benchmark';
    return {
      name: `${isBenchmark ? 'Debug benchmark' : 'Debug test'}: ${testCase.name}`,
      type: 'go',
      request: 'launch',
      program,
      cwd: workspaceRoot,
      mode: 'exec',
      args: isBenchmark
        ? ['-test.run', '^$', '-test.bench', goTestRunPattern(testCase.name)]
        : [goTestRunPattern(testCase.name)],
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
