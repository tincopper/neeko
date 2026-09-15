/**
 * Java 运行前置（模块根探测 · 编译预检 · launcher 与 classpath 产物供给）。
 *
 * 从 `utils/testCommands.ts` 与 `exec/java.ts` 迁入（方案 B 阶段 2 收尾）：这些步骤既要读文件、
 * 又要跑 `mvn`、还要发通知 —— 全部经 [`LangIo`] 注入，故本模块可脱离 Tauri 单测。
 * 调试链路的编排（attach / JDTLS）留在 `exec/java.ts`，阶段 3 迁入本目录。
 */
import type { TestActionContext } from '../../exec/context';
import { runRootRelativeParts } from '../../exec/paths';
import type { ClasspathSeparator, ExistsProbe, LangIo, ReadTextProbe } from '../contract';

import {
  MAVEN_CLASSPATH_REL_PATH,
  buildMavenClasspathCommand,
  buildMavenClasspathPath,
  classpathSeparatorForPlatform,
  resolveJavaClasspath,
} from './classpath';
import type { JavaCommandEnv } from './commands';
import {
  JUNIT_CONSOLE_LAUNCHER_VERSION,
  buildJavaLauncherPath,
  deriveJavaFqcn,
  junitLauncherJarName,
} from './commands';

/** Java 运行环境注入：launcher 路径 + Maven classpath 产物读取探针 + 目标 JVM 分隔符。 */
/**
 * Java 运行环境注入（buildRunCommand / buildJavaDebugCommand 的 java 分支）：
 * - `launcherPath`：Console Launcher jar 绝对路径（缺失回退 bare 文件名）；
 * - `readText`：读取 `mvn dependency:build-classpath` 产物（.neeko/java-classpath.txt）
 *   的探针（调用方 bind projectId）；缺失时 deps 为空 → classpath 仅含 target/ 输出目录。
 * - `classpathSeparator`：**目标 JVM** 的 `File.pathSeparator`（见 `classpathSeparatorFor`）。
 *   必填：由该 env 的产出口一次性解析，避免下游各自推断（宿主 / 目标语义不得混用）。
 */
export interface JavaRunEnv {
  launcherPath?: string;
  readText?: ReadTextProbe;
  classpathSeparator: ClasspathSeparator;
}

/** Java 模块标记文件（Maven 优先，Gradle 两种 DSL 次之）。 */
const JAVA_MODULE_MARKERS = ['pom.xml', 'build.gradle.kts', 'build.gradle'];

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
  probe: ExistsProbe,
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
  probe: ExistsProbe,
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

/**
 * Java 模块运行根：从测试文件向上找最近 `pom.xml`/`build.gradle[.kts]`（多模块工程
 * 定位到子模块，classpath/reports/classpath 产物全部按模块根拼）；找不到回退 runRoot。
 * 探测失败不阻塞（沿用 Go 分支降级惯例）。
 */
export async function resolveJavaRunRoot(
  runRoot: string,
  filePath: string,
  io: LangIo,
): Promise<string> {
  if (!runRoot) return runRoot;
  try {
    const modDir = await findJavaModuleDir(filePath, runRoot, io.fileExists);
    return modDir ? `${runRoot.replace(/[/\\]+$/, '')}/${modDir}` : runRoot;
  } catch {
    return runRoot;
  }
}

/**
 * Java 编译产物预检：用例类在模块输出目录（Maven `target/` / Gradle `build/`）无
 * `.class` → 返回阻断文案（调用方展示后中止），否则 null。
 * 未编译是 attach 调试"卡 running"的首因：Console Launcher 报 ClassNotFound、0 tests、
 * JVM 直接退出，断点永不命中 —— 必须fail fast 给出指引，而非静默启动会话。
 */
export async function checkJavaCompiled(
  javaRoot: string,
  filePath: string,
  io: LangIo,
): Promise<string | null> {
  const fqcn = deriveJavaFqcn(filePath);
  const ok = await javaCompiledClassExists(javaRoot, fqcn, io.fileExists).catch(() => true);
  if (ok) return null;
  return (
    `Test class ${fqcn} is not compiled (no class output under ${javaRoot}/target); ` +
    'breakpoints cannot be hit. Run mvn test-compile (Gradle: ./gradlew testClasses) ' +
    'in the module directory, then retry.'
  );
}

/** Java 依赖 classpath 文本读取探针（bind projectId + runRoot）：读 .neeko/java-classpath.txt。
 *  缺失/读取失败返回 null（resolveJavaClasspath 退化为仅 target/ 目录 classpath）。 */
function javaClasspathReader(projectId: string, runRoot: string, io: LangIo): ReadTextProbe {
  return async () => {
    return io.readText(projectId, MAVEN_CLASSPATH_REL_PATH, runRoot || null);
  };
}

/** JUnit Platform Console Launcher 下载 URL（research §2.1：Maven Central 1.x 线）。 */
export function junitLauncherDownloadUrl(version = JUNIT_CONSOLE_LAUNCHER_VERSION): string {
  return `https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/${version}/${junitLauncherJarName(version)}`;
}

/**
 * 确保 Maven 依赖 classpath 产物存在（.neeko/java-classpath.txt，run 根下 gitignored）。
 * run 根有 pom.xml 且产物缺失时，无头跑 `buildMavenClasspathCommand` 生成（复用
 * debug_build_test_binary 通道）；生成失败（无 mvn / 网络 / IPC）静默降级为仅
 * target/ 目录 classpath —— 不阻塞 Run（standalone launcher 自带 Jupiter/Vintage 引擎，
 * 简单项目仍可跑）。Gradle 项目（pom.xml 缺失）不做探测（research §3.2：无内置等价任务）。
 */
async function ensureJavaClasspathFile(
  ctx: TestActionContext,
  runRoot: string,
  io: LangIo,
): Promise<void> {
  if (!runRoot) return;
  const exists = await io.fileExists(buildMavenClasspathPath(runRoot));
  if (exists) return;
  const hasPom = await io.fileExists(`${runRoot.replace(/[/\\]+$/, '')}/pom.xml`);
  if (!hasPom) return;
  try {
    const result = await io.runBuild({
      projectId: ctx.projectId,
      command: buildMavenClasspathCommand(runRoot),
      cwd: runRoot,
    });
    if (result.exitCode !== 0) {
      console.warn(
        '[TestRun] maven dependency:build-classpath failed; Java classpath degraded to target/ only',
        `${result.stdout}\n${result.stderr}`,
      );
    }
  } catch (e) {
    console.warn(
      '[TestRun] maven build-classpath unavailable (no mvn?); degraded to target/ only',
      e,
    );
  }
}

/**
 * Java 运行前置：launcher jar 供给 + 依赖 classpath 产物准备。
 * - launcher 缺失（~/.neeko/ 缓存，research §2.1 URL）：通知下载并返回 null（调用方跳过运行）；
 * - launcher 就绪：确保 Maven classpath 产物存在，返回 JavaRunEnv（launcherPath + 读取探针）。
 */
export async function prepareJavaRun(
  ctx: TestActionContext,
  runRoot: string,
  io: LangIo,
): Promise<JavaRunEnv | null> {
  const home = await io.homeDir();
  const launcherPath = buildJavaLauncherPath(home || undefined);
  const launcherOk = await io.fileExists(launcherPath);
  if (!launcherOk) {
    const url = junitLauncherDownloadUrl();
    io.notify({
      type: 'error',
      title: 'Java Test',
      message: `JUnit Platform Console Launcher is required (one-time download).\nDownload: ${url}\nSave to: ${launcherPath}`,
    });
    return null;
  }
  await ensureJavaClasspathFile(ctx, runRoot, io);
  return {
    launcherPath,
    readText: javaClasspathReader(ctx.projectId, runRoot, io),
    classpathSeparator: classpathSeparatorForPlatform(io.targetPlatform(ctx.projectId)),
  };
}

/**
 * Java main 运行前置（轻量版）：只确保 Maven 依赖 classpath 产物存在，不要求
 * JUnit Console Launcher —— 应用 main 直跑不需要 launcher jar（测试才需要）。
 */
export async function prepareJavaMainRun(
  ctx: TestActionContext,
  runRoot: string,
  io: LangIo,
): Promise<JavaRunEnv> {
  await ensureJavaClasspathFile(ctx, runRoot, io);
  return {
    readText: javaClasspathReader(ctx.projectId, runRoot, io),
    classpathSeparator: classpathSeparatorForPlatform(io.targetPlatform(ctx.projectId)),
  };
}

/**
 * Java 命令入参（classpath / launcher / **目标 JVM 分隔符**）—— **本模块是唯一解析点**。
 *
 * run 链路（`index.ts`）与调试链路（`debug.ts`）共用本函数：此前两处各写一份，且 run 侧
 * 以硬编码 `':'` 兜底 —— Windows 目标（Local + Windows 宿主）会拼出 Linux 语义的 classpath
 * （`a.jar;b.jar` 被当成单条路径）。此处统一改为按 **`io` 的目标平台**兜底。
 *
 * `separator` 正常情况下由 `prepareJavaRun` 产出（`JavaRunEnv.classpathSeparator`）；
 * `??` 分支只服务「env 由测试/旧路径构造而未带分隔符」的场景。
 */
export async function javaCommandEnv(
  javaRoot: string,
  javaEnv: JavaRunEnv,
  projectId: string,
  io: LangIo,
): Promise<JavaCommandEnv> {
  const separator =
    javaEnv.classpathSeparator ?? classpathSeparatorForPlatform(io.targetPlatform(projectId));
  return {
    separator,
    deps: javaEnv.readText ? await resolveJavaClasspath(javaRoot, javaEnv.readText, separator) : '',
    launcher: javaEnv.launcherPath ?? junitLauncherJarName(),
  };
}
