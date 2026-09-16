/**
 * Java Debug 编排（attach-first jdwp + JDTLS 后端双通道）。
 *
 * 方案 B 阶段 3：本文件原先住在 `exec/java.ts`（通用目录），现整体归位到语言目录 —— Java 的
 * 全部知识（发现 / 命令 / 运行前置 / 调试 / 结果）自此都在 `languages/java/` 下。
 *
 * IO 一律经 `languages/io` 的 [`langIo`]（LSP bundle / 重启、后端配置、文件与构建），
 * 故本模块不直接 import lsp / settings / shared store。
 */
import { useDebugStore } from '@/features/runner/store/debugStore';
import { useJavaDebugStore } from '@/features/runner/store/javaDebugStore';
import type { JavaDebugBackend, JavaJdtlsTarget } from '@/features/runner/types';
import { prefersJdtlsBackend } from '@/shared/utils/javaDebugBackend';

import { resolveRunCwd, type TestActionContext } from '../../exec/context';
import { notifyDebugError } from '../../exec/debugConsole';
import type { RunTarget } from '../../runTarget';
import { langIo } from '../io';

import {
  buildJavaClasspathEntries,
  buildJavaDebugCommand,
  buildJavaLauncherArgs,
  buildJavaLauncherPath,
  buildMainJavaDebugCommand,
  buildMavenTestCompileCommand,
  deriveJavaFqcn,
  isMavenAggregatePom,
  javaClassName,
  mavenArtifactId,
  JUNIT_CONSOLE_LAUNCHER_MAIN_CLASS,
  type JavaBuildSystem,
} from './commands';
import {
  checkJavaCompiled,
  javaCommandEnv,
  junitLauncherDownloadUrl,
  prepareJavaMainRun,
  prepareJavaRun,
  resolveJavaRunRoot,
} from './env';
import { javaIo } from './io';
import {
  enrichJavaTestCase,
  fetchJavaSymbols,
  javaSelectorProblem,
  withJavaNestedClassPath,
} from './symbols';

/**
 * Java Debug（测试与 main 共用，J3 attach-first）：编译产物预检 → classpath/launcher
 * 前置 → jdwp 命令 → `startJavaAttach`（后端 spawn JVM → 解析 jdwp 端口 → JavaAdapter
 * attach 会话）。成功切 session tab；失败走 launchSession 既有错误路径。
 */
/**
 * B'（JDTLS 后端）分支：能力探测 → 直连 JDTLS 内 DAP 端口 → `launch`。
 *
 * 返回 `true` 表示本次动作已被消费（起了会话 / 显示了 warming / 报了不可用）；
 * 返回 `false` 仅发生在一种情况 —— `auto` 下**静态可判定**的不可用且用户**明确确认**
 * 改用 Host（显式选择，不是静默降级）。
 *
 * classpath 由 JDTLS 提供（真值单源），因此这里**不**触发 Maven classpath 产物准备；
 * 测试目标仍需要 Console Launcher jar（只做存在性检查与下载指引）。
 */
/**
 * 模块根 / 聚合根守卫（B' 的 launch 前不变式）。
 *
 * 返回阻断原因，或 `null`（可继续）。两条判据都针对"会静默错"的场景：
 * - 模块根下既无 `pom.xml` 也无 `build.gradle[.kts]` → 无法确定模块 → **硬报错**
 *   （静默用项目根可能落到聚合根或错误模块，classpath 全错且不可自诊）；
 * - Maven 聚合根（`<packaging>pom</packaging>`）→ 自身没有可调试 classpath →
 *   硬报错并指引到子模块。
 */
async function javaBuildSystem(javaRoot: string): Promise<JavaBuildSystem | null> {
  const root = javaRoot.replace(/[/\\]+$/, '');
  if (await langIo.fileExists(`${root}/pom.xml`)) return 'maven';
  if (
    (await langIo.fileExists(`${root}/build.gradle`)) ||
    (await langIo.fileExists(`${root}/build.gradle.kts`))
  ) {
    return 'gradle';
  }
  return null;
}

/**
 * 编译产物预检 + **一次性**自动编译（M3）。
 *
 * 未编译时 Console Launcher 报 ClassNotFound → 断点永不命中（静默失败）。因此缺产物时
 * 触发**一次** `test-compile`：失败即阻断并给出真实报错（不静默继续），成功则复核。
 */
async function ensureJavaCompiled(
  ctx: TestActionContext,
  javaRoot: string,
  filePath: string,
): Promise<string | null> {
  const missing = await checkJavaCompiled(javaRoot, filePath, langIo);
  if (!missing) return null;

  // 仅 Maven 自动编译（Gradle 在缺产物时回落到原有指引文案 —— 见 buildMavenTestCompileCommand）。
  if ((await javaBuildSystem(javaRoot)) !== 'maven') return missing;

  const command = buildMavenTestCompileCommand();
  useDebugStore.getState().pushConsole('sys', `Compiling test classes once: ${command}`);
  try {
    const out = await langIo.runBuild({ projectId: ctx.projectId, command, cwd: javaRoot });
    if (out.exitCode !== 0) {
      const detail = (out.stderr || out.stdout).trim();
      return `Java test compilation failed (exit ${out.exitCode}).${detail ? `\n${detail}` : ''}`;
    }
  } catch (e) {
    return `Java test compilation could not run: ${String(e)}`;
  }
  // 编译后复核：仍缺产物才阻断（构建系统可能把输出放到非默认目录）。
  return checkJavaCompiled(javaRoot, filePath, langIo);
}

async function javaBuildGuard(javaRoot: string, pom: string | null): Promise<string | null> {
  const root = javaRoot.replace(/[/\\]+$/, '');
  const system = await javaBuildSystem(javaRoot);

  if (system === null) {
    return (
      `No Maven/Gradle build file found at ${root}. ` +
      'The JDTLS backend needs a build-system project to resolve the test classpath. ' +
      'Open the file from inside its module (where pom.xml / build.gradle lives) and retry.'
    );
  }
  if (system === 'maven' && pom && isMavenAggregatePom(pom)) {
    return (
      `${root} is a Maven aggregator (packaging=pom) with no classpath of its own. ` +
      'Debug the test from its own module directory instead.'
    );
  }
  return null;
}

/** 读模块 `pom.xml` 文本（缺失 / 读取失败 → `null`；聚合根判定与项目名候选共用一次读取）。 */
async function readModulePom(ctx: TestActionContext, javaRoot: string): Promise<string | null> {
  const root = javaRoot.replace(/[/\\]+$/, '');
  return langIo.readText(ctx.projectId, 'pom.xml', root);
}

/**
 * JDT 项目名的**候选**（不是结论）：Maven `artifactId` 优先，其次模块目录名（Gradle 等）。
 *
 * 真机：**目录名不是 JDT 项目名** —— jdt.ls 会以
 * `The project '<x>' is not a valid java project` 拒绝；Maven 项目名默认等于 `artifactId`。
 * 该候选会被后端交给 jdt.ls **验证**，不被接受则退回"服务器按类解析"（不猜第二遍）。
 */
function javaProjectNameCandidate(pom: string | null, javaRoot: string): string | null {
  const fromPom = pom ? mavenArtifactId(pom) : null;
  if (fromPom) return fromPom;
  const base = javaRoot
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop();
  return base && base.trim() ? base : null;
}

/** info 级通知（下载/重启等非错误提示）。 */
function debugNotifyInfo(message: string) {
  langIo.notify({ type: 'info', title: 'Debug', message });
}

/**
 * 「改用 Host 后端」的确认（唯一文案来源：两个 terminal 分支共用）。
 *
 * 走 `confirmAction`（应用级确认入口）而不是 `window.confirm`：后者在 Tauri 的
 * WKWebView 下可能直接返回 false，会让这条降级入口变成**死路**；且它绕过应用的
 * 对话框样式与文案规范。
 */
function confirmHostFallback(reason: string): Promise<boolean> {
  return langIo.confirm({
    title: 'Debug with the host backend?',
    message: `${reason}\n\nExpression evaluation is not available with the host backend.`,
    confirmLabel: 'Use host backend',
  });
}

/** 「下载 java-debug 插件并重启 Java 语言服务器」的确认。 */
function confirmInstallBundle(reason: string): Promise<boolean> {
  return langIo.confirm({
    title: 'Install the java-debug plugin?',
    message: `${reason}\n\nDownload the plugin and restart the Java language server now?`,
    confirmLabel: 'Download and restart',
  });
}

async function debugJavaViaJdtls(
  target: RunTarget,
  ctx: TestActionContext,
  javaRoot: string,
  backend: JavaDebugBackend,
): Promise<boolean> {
  const isTest = target.kind === 'test';
  const fqcn = deriveJavaFqcn(ctx.filePath);
  let probeClass = fqcn;
  let mainClass = fqcn;
  let args: string[] = [];
  let testName = 'main';
  let launcherJar: string | null = null;

  // ── launch 前不变式 ①：模块根 / 聚合根（避免 classpath 静默取错）─────────
  // 模块 pom 只读一次，供"聚合根判定"与"项目名候选"共用。
  const modulePom = await readModulePom(ctx, javaRoot);
  const buildProblem = await javaBuildGuard(javaRoot, modulePom);
  if (buildProblem) {
    useDebugStore.getState().pushConsole('err', buildProblem);
    notifyDebugError(buildProblem);
    // `auto` 下这属**静态可判定**的 terminal（B' 永远无法用于无构建系统的工程）：
    // 与 BundleMissing 同样给"一次性确认改用 Host"，而不是留下死路。
    if (backend === 'auto') {
      if (await confirmHostFallback(buildProblem)) {
        useJavaDebugStore.getState().markHostFallback(ctx.projectId);
        useJavaDebugStore.getState().setBackendLabel('host (fallback)');
        return false;
      }
    }
    return true;
  }

  if (isTest) {
    // ── launch 前不变式 ②：选择器存在性（避免"running 但断点永不命中"）────
    const symbols = await fetchJavaSymbols(ctx, langIo);
    if (symbols) {
      const problem = javaSelectorProblem(symbols, target.testCase);
      if (problem) {
        useDebugStore.getState().pushConsole('err', problem);
        notifyDebugError(problem);
        return true;
      }
    }
    const home = await langIo.homeDir();
    const launcherPath = buildJavaLauncherPath(home || undefined);
    if (!(await langIo.fileExists(launcherPath))) {
      const msg =
        `JUnit Platform Console Launcher is required (one-time download).\n` +
        `Download: ${junitLauncherDownloadUrl()}\nSave to: ${launcherPath}`;
      useDebugStore.getState().pushConsole('err', msg);
      notifyDebugError(msg);
      return true;
    }
    // `@Nested` 内层类链（与 Run 链路同源，复用上面已取的符号表）；无法判断时原样。
    const testCase = symbols ? enrichJavaTestCase(target.testCase, symbols) : target.testCase;
    probeClass = javaClassName(fqcn, testCase);
    args = buildJavaLauncherArgs(testCase, ctx.filePath, javaRoot);
    mainClass = JUNIT_CONSOLE_LAUNCHER_MAIN_CLASS;
    testName = testCase.name;
    launcherJar = launcherPath;
  }

  const jdtlsTarget: JavaJdtlsTarget = {
    probeClass,
    cwd: javaRoot,
    testName,
    mainClass,
    args,
    launcherJar,
    // 候选而已：后端会交给 jdt.ls 验证；不成立时退回按类解析（绝不传猜值当结论）。
    projectName: javaProjectNameCandidate(modulePom, javaRoot),
  };
  const result = await useJavaDebugStore.getState().startJavaDebug(ctx.projectId, jdtlsTarget);
  // undefined = 被在途启动链拦截（评审 P3 互斥）——视同无事发生。
  if (!result || result.kind !== 'unavailable') return true;

  // 静态可判定的 terminal：**先给真正的修复**（下载 bundle + 重启 Java 会话 + 重试一次）；
  // 只有在用户放弃修复时（且 auto）才询问是否降级到 Host —— 降级永不自动发生。
  if (result.staticallyDetectable) {
    const wantFix = await confirmInstallBundle(result.message);
    if (wantFix) {
      try {
        await javaIo.ensureDebugBundle();
        if (ctx.projectPath) await javaIo.restartLspSession(ctx.projectPath);
        const retry = await useJavaDebugStore.getState().startJavaDebug(ctx.projectId, jdtlsTarget);
        if (!retry || retry.kind === 'session') return true;
        const note =
          retry.kind === 'warming'
            ? 'java-debug plugin installed. The Java language server is restarting — click Debug again in a moment.'
            : `java-debug plugin installed, but the JDTLS backend is still unavailable: ${
                retry.kind === 'unavailable' ? retry.message : 'unknown reason'
              }`;
        useDebugStore.getState().pushConsole('sys', note);
        debugNotifyInfo(note);
        return true;
      } catch (e) {
        const msg = `Failed to install the java-debug plugin: ${String(e)}`;
        useDebugStore.getState().pushConsole('err', msg);
        notifyDebugError(msg);
      }
    }
    if (backend === 'auto') {
      // 用户**显式**确认的降级：记住（仅本项目会话）+ 标注为 fallback。
      if (await confirmHostFallback(result.message)) {
        useJavaDebugStore.getState().markHostFallback(ctx.projectId);
        useJavaDebugStore.getState().setBackendLabel('host (fallback)');
        return false;
      }
      return true;
    }
  }
  return true;
}

export async function debugJava(target: RunTarget, ctx: TestActionContext): Promise<void> {
  const debug = useDebugStore.getState();
  const cwd = resolveRunCwd(ctx);
  const javaRoot = await resolveJavaRunRoot(cwd, ctx.filePath, langIo);
  // 编译产物预检：未编译时 JVM 报 ClassNotFound、直接退出，断点永不命中 ——
  // fail fast 给出指引，不启动会话（避免 Debug 面板永久 running）。
  const blockReason = await ensureJavaCompiled(ctx, javaRoot, ctx.filePath);
  if (blockReason) {
    debug.pushConsole('err', blockReason);
    notifyDebugError(blockReason);
    return;
  }
  // 后端 dispatch：配置读取仅作 hint（后端在同一次调用内权威复核）。
  // `host` → 既有 A 路径（逐字不变）；`auto` / `jdtls` → B'。
  const backend = await javaIo.readDebugBackend();
  // 本项目已**显式确认**降级 → 尊重用户选择，不再探测（「重试 JDTLS」可清除该记忆）。
  const rememberedFallback = useJavaDebugStore.getState().isHostFallback(ctx.projectId);
  if (!rememberedFallback && prefersJdtlsBackend(backend)) {
    const consumed = await debugJavaViaJdtls(target, ctx, javaRoot, backend);
    if (consumed) return;
  }
  // A（自写 host）路径：标注后端能力受限（无求值），供面板禁用求值输入。
  // 记住的降级要区分于"配置直选 host"，便于面板给出「重试 JDTLS」。
  useJavaDebugStore
    .getState()
    .setBackendLabel(
      useJavaDebugStore.getState().isHostFallback(ctx.projectId) ? 'host (fallback)' : 'host',
    );
  if (target.kind === 'test') {
    debug.pushConsole('sys', 'Starting Java test JVM (jdwp suspended, waiting for attach)…');
    const javaEnv = await prepareJavaRun(ctx, javaRoot, langIo);
    if (!javaEnv) return;
    const env = await javaCommandEnv(javaRoot, javaEnv, ctx.projectId, langIo);
    // `@Nested` 内层类链（同 Run 链路）：降级时原样 → 选择器与历史一致。
    const testCase = await withJavaNestedClassPath(ctx, target.testCase, langIo);
    const command = buildJavaDebugCommand(testCase, ctx.filePath, javaRoot, env);
    // 逐条 classpath 交给 host：JDI 栈帧只有包相对源码路径，host 需要 classpath
    // 才能定位依赖 jar 的 sources / JDK src.zip（详见 JavaAdapter/Host 注释）。
    const classpath = buildJavaClasspathEntries(javaRoot, env.deps, env.separator);
    try {
      await useJavaDebugStore
        .getState()
        .startJavaAttach(ctx.projectId, command, javaRoot, testCase.name, classpath);
    } catch {
      // launchSession 错误路径已处理（console + 通知），此处不重复
    }
    return;
  }
  debug.pushConsole('sys', 'Starting Java app JVM (jdwp suspended, waiting for attach)…');
  const javaEnv = await prepareJavaMainRun(ctx, javaRoot, langIo);
  const env = await javaCommandEnv(javaRoot, javaEnv, ctx.projectId, langIo);
  const command = buildMainJavaDebugCommand(ctx.filePath, javaRoot, env);
  const classpath = buildJavaClasspathEntries(javaRoot, env.deps, env.separator);
  try {
    await useJavaDebugStore
      .getState()
      .startJavaAttach(ctx.projectId, command, javaRoot, 'main', classpath);
  } catch {
    // launchSession 错误路径已处理（console + 通知），此处不重复
  }
}
