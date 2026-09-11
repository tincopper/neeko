/**
 * Java 运行/Debug 前置（模块根探测 · 编译预检 · launcher 与 classpath 供给）
 * + attach-first（jdwp）调试启动。
 */
import { homeDir } from '@tauri-apps/api/path';

import { buildTestBinaryRemote } from '@/features/debug/api/debugBuildApi';
import { useDebugStore } from '@/features/debug/store/debugStore';
import { fileExists, readFileContent } from '@/features/file/api/fileApi';
import { lspRequest } from '@/features/lsp/api/lspApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { fileRefFromTabPath, lspUriOf } from '@/shared/utils/fileRef';

import type { RunTarget } from '../gutter/runTarget';
import { nestedClassPath, parseJavaSymbols } from '../utils/javaDocumentSymbol';
import { isLspLanguageReady } from '../utils/lspReadiness';
import { resolveRunContext } from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import {
  buildJavaDebugCommand,
  buildJavaLauncherPath,
  buildMainJavaDebugCommand,
  buildMavenClasspathCommand,
  buildMavenClasspathPath,
  deriveJavaFqcn,
  findJavaModuleDir,
  javaCompiledClassExists,
  JUNIT_CONSOLE_LAUNCHER_VERSION,
  junitLauncherJarName,
  MAVEN_CLASSPATH_REL_PATH,
  type JavaRunEnv,
  type ReadTextProbe,
} from '../utils/testCommands';

import { resolveRunCwd, type TestActionContext } from './context';
import { notifyDebugError } from './debugConsole';

/**
 * Java 模块运行根：从测试文件向上找最近 `pom.xml`/`build.gradle[.kts]`（多模块工程
 * 定位到子模块，classpath/reports/classpath 产物全部按模块根拼）；找不到回退 runRoot。
 * 探测失败不阻塞（沿用 Go 分支降级惯例）。
 */
export async function resolveJavaRunRoot(runRoot: string, filePath: string): Promise<string> {
  if (!runRoot) return runRoot;
  try {
    const modDir = await findJavaModuleDir(filePath, runRoot);
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
): Promise<string | null> {
  const fqcn = deriveJavaFqcn(filePath);
  const ok = await javaCompiledClassExists(javaRoot, fqcn).catch(() => true);
  if (ok) return null;
  return (
    `Test class ${fqcn} is not compiled (no class output under ${javaRoot}/target); ` +
    'breakpoints cannot be hit. Run mvn test-compile (Gradle: ./gradlew testClasses) ' +
    'in the module directory, then retry.'
  );
}

/**
 * 用 LSP `textDocument/documentSymbol` 求 `@Nested` **内层类链**，附到用例上
 * （`TestCaseInfo.nestedClassPath`），供选择器拼 `$`（design §7.7）。
 *
 * 为什么在这里而不是 gutter：gutter marker 构建必须保持**同步纯函数**，而本结果是异步 LSP 产物；
 * runner 层本就是 Java 的异步 IO 边界（模块根探测 / classpath 读取）。
 *
 * **降级即现状**：无项目根 / java 会话未就绪（不发请求）/ 请求失败 / 载荷里找不到该方法
 * → 原样返回 `testCase` → 选择器与历史形态逐字节一致。任何异常都不外抛（最坏等于今天）。
 */
export async function withJavaNestedClassPath(
  ctx: TestActionContext,
  testCase: TestCaseInfo,
): Promise<TestCaseInfo> {
  const projectPath = ctx.projectPath;
  if (!projectPath) return testCase;
  if (!isLspLanguageReady(projectPath, 'java')) return testCase;

  // 路径形态唯一所有权归 fileRef：`ctx.filePath` 允许相对（对项目根）或绝对，canonicalFsPath 两者都接。
  const uri = lspUriOf(fileRefFromTabPath(projectPath, ctx.filePath));
  if (!uri) return testCase;

  try {
    const raw = await lspRequest(projectPath, 'java', 'textDocument/documentSymbol', {
      textDocument: { uri },
    });
    const nested = nestedClassPath(parseJavaSymbols(raw), testCase.name, testCase.line);
    return nested.length > 0 ? { ...testCase, nestedClassPath: nested } : testCase;
  } catch {
    return testCase;
  }
}

// ── Java 运行前置（launcher 供给 + Maven 依赖 classpath）──────────────────────
/** Java 依赖 classpath 文本读取探针（bind projectId + runRoot）：读 .neeko/java-classpath.txt。
 *  缺失/读取失败返回 null（resolveJavaClasspath 退化为仅 target/ 目录 classpath）。 */
function javaClasspathReader(projectId: string, runRoot: string): ReadTextProbe {
  return async () => {
    try {
      const file = await readFileContent(projectId, MAVEN_CLASSPATH_REL_PATH, runRoot || null);
      return file.content || null;
    } catch {
      return null;
    }
  };
}

/** JUnit Platform Console Launcher 下载 URL（research §2.1：Maven Central 1.x 线）。 */
function junitLauncherDownloadUrl(version = JUNIT_CONSOLE_LAUNCHER_VERSION): string {
  return `https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/${version}/${junitLauncherJarName(version)}`;
}

/**
 * 确保 Maven 依赖 classpath 产物存在（.neeko/java-classpath.txt，run 根下 gitignored）。
 * run 根有 pom.xml 且产物缺失时，无头跑 `buildMavenClasspathCommand` 生成（复用
 * debug_build_test_binary 通道）；生成失败（无 mvn / 网络 / IPC）静默降级为仅
 * target/ 目录 classpath —— 不阻塞 Run（standalone launcher 自带 Jupiter/Vintage 引擎，
 * 简单项目仍可跑）。Gradle 项目（pom.xml 缺失）不做探测（research §3.2：无内置等价任务）。
 */
async function ensureJavaClasspathFile(ctx: TestActionContext, runRoot: string): Promise<void> {
  if (!runRoot) return;
  const exists = await fileExists(buildMavenClasspathPath(runRoot)).catch(() => false);
  if (exists) return;
  const hasPom = await fileExists(`${runRoot.replace(/[/\\]+$/, '')}/pom.xml`).catch(() => false);
  if (!hasPom) return;
  try {
    const result = await buildTestBinaryRemote({
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
): Promise<JavaRunEnv | null> {
  const home = await homeDir().catch(() => '');
  const launcherPath = buildJavaLauncherPath(home || undefined);
  const launcherOk = await fileExists(launcherPath).catch(() => false);
  if (!launcherOk) {
    const url = junitLauncherDownloadUrl();
    useNotificationStore.getState().addNotification({
      type: 'error',
      title: 'Java Test',
      message: `JUnit Platform Console Launcher is required (one-time download).\nDownload: ${url}\nSave to: ${launcherPath}`,
    });
    return null;
  }
  await ensureJavaClasspathFile(ctx, runRoot);
  return { launcherPath, readText: javaClasspathReader(ctx.projectId, runRoot) };
}

/**
 * Java main 运行前置（轻量版）：只确保 Maven 依赖 classpath 产物存在，不要求
 * JUnit Console Launcher —— 应用 main 直跑不需要 launcher jar（测试才需要）。
 */
export async function prepareJavaMainRun(
  ctx: TestActionContext,
  runRoot: string,
): Promise<JavaRunEnv> {
  await ensureJavaClasspathFile(ctx, runRoot);
  return { readText: javaClasspathReader(ctx.projectId, runRoot) };
}

/**
 * Java Debug（测试与 main 共用，J3 attach-first）：编译产物预检 → classpath/launcher
 * 前置 → jdwp 命令 → `startJavaAttach`（后端 spawn JVM → 解析 jdwp 端口 → JavaAdapter
 * attach 会话）。成功切 session tab；失败走 launchSession 既有错误路径。
 */
export async function debugJava(target: RunTarget, ctx: TestActionContext): Promise<void> {
  const debug = useDebugStore.getState();
  const cwd = resolveRunCwd(ctx);
  const javaRoot = await resolveJavaRunRoot(cwd, ctx.filePath);
  // 编译产物预检：未编译时 JVM 报 ClassNotFound、直接退出，断点永不命中 ——
  // fail fast 给出指引，不启动会话（避免 Debug 面板永久 running）。
  const blockReason = await checkJavaCompiled(javaRoot, ctx.filePath);
  if (blockReason) {
    debug.pushConsole('err', blockReason);
    notifyDebugError(blockReason);
    return;
  }
  if (target.kind === 'test') {
    debug.pushConsole('sys', 'Starting Java test JVM (jdwp suspended, waiting for attach)…');
    const javaEnv = await prepareJavaRun(ctx, javaRoot);
    if (!javaEnv) return;
    const runCtx = await resolveRunContext('java', ctx.filePath, javaRoot, { javaEnv });
    // `@Nested` 内层类链（同 Run 链路）：降级时原样 → 选择器与历史一致。
    const testCase = await withJavaNestedClassPath(ctx, target.testCase);
    const command = buildJavaDebugCommand(testCase, ctx.filePath, javaRoot, runCtx);
    try {
      await useDebugStore
        .getState()
        .startJavaAttach(ctx.projectId, command, javaRoot, testCase.name);
    } catch {
      // launchSession 错误路径已处理（console + 通知），此处不重复
    }
    return;
  }
  debug.pushConsole('sys', 'Starting Java app JVM (jdwp suspended, waiting for attach)…');
  const javaEnv = await prepareJavaMainRun(ctx, javaRoot);
  const runCtx = await resolveRunContext('java', ctx.filePath, javaRoot, { javaEnv });
  const command = buildMainJavaDebugCommand(ctx.filePath, javaRoot, runCtx);
  try {
    await useDebugStore.getState().startJavaAttach(ctx.projectId, command, javaRoot, 'main');
  } catch {
    // launchSession 错误路径已处理（console + 通知），此处不重复
  }
}
