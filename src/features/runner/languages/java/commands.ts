/**
 * Java run/Debug 命令构造（纯函数：FQCN 推导、`@Nested` 选择器、Console Launcher 与 classpath）。
 *
 * 从 `utils/testCommands.ts` 迁入（方案 B 阶段 2 收尾）：命令形态是**该语言的知识**，与
 * `discover.ts`（发现）、`symbols.ts`（LSP 富化）、`env.ts`（运行前置产物）同住。
 * 入参是语言私有 `JavaCommandEnv`（旧共享 `RunContext` 袋已随本阶段消失）。
 */
import { shQuote } from '../../exec/shell';
import type { TestCaseInfo } from '../../syntax/contract';
import type { ClasspathSeparator } from '../contract';

/** Java 命令构造入参（语言私有 —— 旧共享 `RunContext` 袋已不存在）。 */
export interface JavaCommandEnv {
  /** Maven 依赖 classpath（`''` → 退化为仅 `target/` 输出目录）。 */
  deps: string;
  /** Console Launcher jar（绝对路径或 bare 文件名）。 */
  launcher: string;
  /** 目标 JVM 的 classpath 分隔符（`;` / `:`）。 */
  separator: ClasspathSeparator;
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
 * classpath（host 侧据此解析第三方库 / JDK 源码），故在此分流 —— 分隔符与拼接同源
 * （同一个 `separator`），`deps` 已在 `parseClasspathOutput` 归一（无空条目）。
 *
 * `separator` 必填：拆分必须与 `deps` 的产出 JVM（`File.pathSeparator`）一致，
 * 否则 Windows 目标的 `a.jar;b.jar` 会被当成**单条**条目（host 侧静默解析不到源码）。
 */
export function buildJavaClasspathEntries(
  runRoot: string,
  deps: string,
  separator: ClasspathSeparator,
): string[] {
  const base = runRoot ? `${runRoot}/` : '';
  const entries = [`${base}target/classes`, `${base}target/test-classes`];
  if (deps) entries.push(...deps.split(separator).filter((entry) => entry.length > 0));
  return entries;
}

/**
 * Java 测试运行时 classpath：`<root>/target/classes<sep><root>/target/test-classes[<sep><deps>]`。
 * deps 为 `mvn dependency:build-classpath` 产物（.neeko/java-classpath.txt，
 * parseClasspathOutput 解析）；Maven 自编译输出目录手工前置拼接（research §3.1：
 * build-classpath 只输出依赖 jar，不含项目自身 classes 输出）。
 * run 根空时回退相对 `target/` 目录（命令 cwd 即 run 根，Shell 通道均成立）。
 *
 * 关键约束：`java -jar` 下 JVM **忽略命令行 `-cp`**，项目 classpath 只能经 Console
 * Launcher 自身的 `--class-path` 选项传入（research §2.2/§2.4）——这是 Java 测试
 * 类能加载的前提。
 *
 * `separator` 必填且须来自**目标环境的 JVM**（`File.pathSeparator`）：Windows 目标用 `;`，
 * Linux/macOS（含 WSL）用 `:`。见 `classpathSeparatorFor`。
 */
export function buildJavaClasspath(
  runRoot: string,
  deps: string,
  separator: ClasspathSeparator,
): string {
  return buildJavaClasspathEntries(runRoot, deps, separator).join(separator);
}

/**
 * Java 用例的 JUnit 方法选择器：`<FQCN>[<$内层类…>]#<method>`。
 *
 * `@Nested` 内层类**必须**用 `$` 连接 —— 真机实证（design §7.7.1）：
 * `com.example.AppTest#testNested` 会报
 * `PreconditionViolationException: Could not find method with name [testNested] in class [com.example.AppTest]`，
 * 而 `com.example.AppTest$InnerCases#testNested` 正确执行 1 个用例。
 * `containerPath` 缺省 / 空 → 与历史形态**逐字节一致**（Run 与 Debug 共用本函数，防两条链路漂移）。
 */
export function javaClassName(fqcn: string, testCase: TestCaseInfo): string {
  const nested = (testCase.containerPath ?? []).map((name) => `$${name}`).join('');
  return `${fqcn}${nested}`;
}

export function javaMethodSelector(fqcn: string, testCase: TestCaseInfo): string {
  return `${javaClassName(fqcn, testCase)}#${testCase.name}`;
}

/**
 * Java 用例的 launcher 参数（B' 的 DAP `launch.args`）。
 *
 * 选择器的**唯一构造点**是 [`javaMethodSelector`]（Run / Debug / 此处共用同一函数），
 * 因此不存在两条链路的选择器漂移；Run / Debug 的 shell 命令保持既有输出不变。
 *
 * 返回**未经 shell 引号**的 argv 片段 —— shell 形态由调用方逐项 `shQuote`，
 * DAP `launch.args` 则直接使用（JVM 由 adapter 侧以 `-classpath` 启动，无需
 * `-jar` / `--class-path`）。
 */
export function buildJavaLauncherArgs(
  testCase: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
): string[] {
  const fqcn = deriveJavaFqcn(relPath);
  return [
    '-m',
    javaMethodSelector(fqcn, testCase),
    `--reports-dir=${buildJunitReportsDir(runRoot ?? '')}`,
  ];
}

/**
 * 从 `pom.xml` 文本取本项目的 `artifactId`（JDT 项目名的**候选**）。
 *
 * 必须**先剥掉 `<parent>` 块**：父 POM 的 `artifactId` 出现在前面，直接取第一个会拿到父坐标
 * —— 那是另一个项目，拿去当 JDT 项目名会被服务器拒。
 *
 * 注意：这只是**候选**，必须由 jdt.ls 验证后才采信（真机：目录名不是 JDT 项目名，
 * Maven 项目名默认等于 `artifactId`）。
 */
export function mavenArtifactId(pomXml: string): string | null {
  const withoutParent = pomXml.replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/gi, '');
  const match = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i.exec(withoutParent);
  return match ? match[1] : null;
}

/**
 * 是否为 Maven **聚合根**（`<packaging>pom</packaging>`）。
 *
 * 聚合根本身没有可供调试的 classpath（`mvn dependency:build-classpath` 与
 * `resolveClasspath` 都拿不到有效结果）→ 必须**硬报错并指引到子模块**，
 * 而不是静默退化成一个必然失败的会话。
 */
export function isMavenAggregatePom(pomXml: string): boolean {
  return /<packaging>\s*pom\s*<\/packaging>/i.test(pomXml);
}

/** Java 构建系统（缺产物时决定是否可自动编译）。 */
export type JavaBuildSystem = 'maven' | 'gradle';

/**
 * Maven 测试编译命令（缺产物时由 runner 触发**一次**）。`-q -B`：只输出错误、非交互。
 *
 * **刻意不做 Gradle**：`./gradlew` 是 POSIX 形式 —— Windows 需要 `gradlew.bat` 且要经
 * `cmd /C`（而非 `sh -c`），跨平台对齐成本与收益不成比例；Gradle 的 classpath/构建模型
 * 本就在本任务范围之外（design §6「Gradle 自定义任务注入不做」）。Gradle 项目在缺产物时
 * 回落到既有指引文案（提示用户手动 `./gradlew testClasses`），不自动执行。
 */
export function buildMavenTestCompileCommand(): string {
  return 'mvn -q -B test-compile';
}

/** Console Launcher 的 DAP `mainClass`（B' 测试调试的 main 类）。 */
export const JUNIT_CONSOLE_LAUNCHER_MAIN_CLASS = 'org.junit.platform.console.ConsoleLauncher';

/** Java：只传 `-m <FQCN#method>`（`-c` 与 `-m` 是 OR 语义，同传会跑整类）。
 *  `--class-path` = target/ 输出 + Maven 依赖产物（env.deps）；launcher 取 ctx。 */
export function buildJavaRunCommand(
  testCase: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
  env: JavaCommandEnv,
): string {
  const fqcn = deriveJavaFqcn(relPath);
  const cp = buildJavaClasspath(runRoot ?? '', env.deps, env.separator);
  return (
    `java -jar ${shQuote(env.launcher)} --class-path=${shQuote(cp)}` +
    ` -m ${shQuote(javaMethodSelector(fqcn, testCase))} --reports-dir=${shQuote(buildJunitReportsDir(runRoot ?? ''))}`
  );
}

/**
 * Java main 入口运行命令（gutter main-run 按钮消费；run-only）：`java -cp <cp> <FQCN>`
 * （classpath 同 Run；调用前须过编译产物预检）。兄弟语言的同名构造器在各自
 * `languages/<lang>/commands.ts`。
 */
export function buildJavaMainRunCommand(
  filePath: string,
  runRoot: string | null | undefined,
  env: JavaCommandEnv,
): string {
  const fqcn = deriveJavaFqcn(filePath);
  const cp = buildJavaClasspath(runRoot ?? '', env.deps, env.separator);
  return `java -cp ${shQuote(cp)} ${fqcn}`;
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
  env: JavaCommandEnv,
): string {
  const fqcn = deriveJavaFqcn(filePath);
  const cp = buildJavaClasspath(runRoot ?? '', env.deps, env.separator);
  return (
    `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0` +
    ` -cp ${shQuote(cp)} ${fqcn}`
  );
}

/**
 * 各语言 main Debug 前置构建命令（**纯函数，无 lang 分支** —— 注册表按语言选取）：
 * - Go `go build -o <out> -gcflags 'all=-N -l' <pkg>`（无优化构建是 dlv 断点/变量
 *   正确性前提；`-o` 显式产物路径，启动时按此解析，无 compiler-artifact）；
 * - Rust `cargo build[ --manifest-path …] --message-format=json`（bin 产物由
 *   `parseCargoBinaryPath` 解析；多 bin 工作区按 sourceHint=被编辑文件消歧）。
 */
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
  env: JavaCommandEnv,
): string {
  const fqcn = deriveJavaFqcn(relPath);
  const cp = buildJavaClasspath(runRoot ?? '', env.deps, env.separator);
  return (
    `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0` +
    ` -jar ${shQuote(env.launcher)} --class-path=${shQuote(cp)}` +
    ` -m ${shQuote(javaMethodSelector(fqcn, testCase))} --reports-dir=${shQuote(buildJunitReportsDir(runRoot ?? ''))}`
  );
}
