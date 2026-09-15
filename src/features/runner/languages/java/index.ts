/**
 * Java 语言模块（`LanguageModule` 实现）。
 *
 * Java 是唯一同时需要「构建系统前置 + 两种调试后端」的语言，故这里的 plan 明显更长：
 * - **模块根**：多模块工程必须下沉到最近 `pom.xml`/`build.gradle` 所在模块，否则 classpath
 *   静默取错（项目根 = 聚合根时更是必然失败）；
 * - **编译产物预检**：缺产物时 Console Launcher 报 ClassNotFound、断点永不命中 → fail fast；
 * - **launcher / Maven classpath 产物供给**：测试链路需要 JUnit Console Launcher jar；
 * - **`@Nested` 内层类链**：选择器要用 `$` 连接内层类，由 LSP `documentSymbol` 富化。
 *
 * **过渡状态（方案 B 阶段 3 收敛）**：上述前置实现此刻仍在 `exec/java.ts`（通用目录），
 * 本模块直导它；阶段 3 会把 `exec/java.ts` 拆入本目录（`env.ts` / `symbols.ts` / `debug.ts`），
 * 届时本文件的 import 全部变成本目录内兄弟模块。命令构造同理来自 `utils/testCommands`（阶段 2）。
 */
import { useJavaDebugStore } from '@/features/runner/store/javaDebugStore';
import { shouldSkipJavaAdapterGate } from '@/shared/utils/javaDebugBackend';

import { buildTestConfigId } from '../../exec/shell';
import type { LangIo, LanguageModule } from '../contract';
import { defaultLabels } from '../labels';

import { buildJavaMainRunCommand, buildJavaRunCommand } from './commands';
import { debugJava } from './debug';
import { discoverJavaMains, discoverJavaTests } from './discover';
import {
  checkJavaCompiled,
  javaCommandEnv,
  prepareJavaMainRun,
  prepareJavaRun,
  resolveJavaRunRoot,
} from './env';
import { javaIo } from './io';
import { readJavaResults } from './results';
import { javaConsoleInvariant } from './runtime';
import { withJavaNestedClassPath } from './symbols';

/**

/** 用例类未编译的阻断通知（Run/主链路的用户可见原因，唯一文案来源）。 */
function notifyBlocked(io: LangIo, title: string, message: string): null {
  io.notify({ type: 'error', title, message });
  return null;
}

export const JAVA: LanguageModule = {
  id: 'java',
  filePolicy: {
    match: (name) => name.endsWith('.java'),
    // 用例由**内容**判定（`@Test`），或命名约定 `*Test.java` / `*Tests.java`。
    isTestCaseFile: (name, docText) =>
      /(?:Test|Tests)\.java$/.test(name) || (docText !== undefined && docText.includes('@Test')),
    hasMain: true,
  },
  discover: (sd) => ({ tests: discoverJavaTests(sd), mains: discoverJavaMains(sd) }),
  readResults: readJavaResults,
  ui: { labels: defaultLabels },
  capabilities: { directRun: false, debug: 'attach' },

  async planTestRun({ ctx, testCase, runRoot, io }) {
    // 多模块工程：运行根下沉到最近 pom.xml / build.gradle 所在模块。
    const javaRoot = await resolveJavaRunRoot(runRoot, ctx.filePath, io);
    const javaEnv = await prepareJavaRun(ctx, javaRoot, io);
    if (!javaEnv) return null; // launcher 缺失（通知已发）→ 阻断
    const blockReason = await checkJavaCompiled(javaRoot, ctx.filePath, io);
    if (blockReason) return notifyBlocked(io, 'Java Test', blockReason);
    // `@Nested` 内层类链（LSP documentSymbol）：不就绪 / 失败 → 原样（选择器与历史一致）。
    const effectiveCase = await withJavaNestedClassPath(ctx, testCase, io);
    return {
      cwd: javaRoot,
      command: buildJavaRunCommand(
        effectiveCase,
        ctx.filePath,
        javaRoot,
        await javaCommandEnv(javaRoot, javaEnv, ctx.projectId, io),
      ),
      configId: buildTestConfigId('run', effectiveCase, ctx.filePath),
    };
  },

  async planMainRun({ ctx, runRoot, io }) {
    const javaRoot = await resolveJavaRunRoot(runRoot, ctx.filePath, io);
    const block = await checkJavaCompiled(javaRoot, ctx.filePath, io);
    if (block) return notifyBlocked(io, 'Java Run', block);
    // main 直跑不需要 launcher jar（仅测试需要）→ 轻量前置。
    const javaEnv = await prepareJavaMainRun(ctx, javaRoot, io);
    return {
      cwd: javaRoot,
      command: buildJavaMainRunCommand(
        ctx.filePath,
        javaRoot,
        await javaCommandEnv(javaRoot, javaEnv, ctx.projectId, io),
      ),
      configId: `main:java:${ctx.filePath}`,
    };
  },

  planDebug: (input) => debugJava(input.target, input.ctx),
  /**
   * 会话生命周期的 Java 专属判定（原先散落在通用 store 里）：
   * - adapter 指引与门控：JDTLS 后端不需要 host jar，故非 `host` 时跳过存在性门控；
   * - 「0 用例」不变式：Console Launcher 汇总 0 用例 → 终止会话（闩锁在 store 上）。
   */
  debugHooks: {
    adapterHint: () =>
      'Run tools/java-host/build.sh to build the Java debug host (requires JDK >= 11), ' +
      'or point `dap.adapterBinaries.java` at a host jar',
    skipAdapterGate: async (configType) =>
      shouldSkipJavaAdapterGate(configType, await javaIo.readDebugBackend()),
    // 判定 + **闩锁**都在本语言自己的 store 上（通用层不再持有该状态）。
    inspectConsoleLine: (line) => {
      const java = useJavaDebugStore.getState();
      const verdict = javaConsoleInvariant(line, {
        backendLabel: java.backendLabel,
        alreadyReported: java.zeroTestReported,
      });
      if (verdict) java.markZeroTestReported();
      return verdict;
    },
  },
};
