/**
 * Run/Debug 动作入口：**表驱动**每语言前置（`registry.runnerFor`）+ 任务会话编排。
 *
 * - Run：前置（语言特有探测/预检）→ 命令构造（`runLanguages` 纯函数）→
 *   `taskStore.runTask` 进 Task Console；onExit 后按结果通道解析回填 gutter。
 * - Debug：能力声明放行（`capabilities.debug`）→ 对应 runner 的 debug 实现
 *   （native：无头构建 → 产物解析 → lldb/dlv；attach：Java jdwp）。
 *
 * 本模块不再含任何 `if lang === …` 分支 —— 语言差异全在注册表。
 */
import { useDebugStore } from '@/features/debug/store/debugStore';
import { useTaskStore } from '@/shared/store/taskStore';

import { targetLang, type RunTarget } from '../gutter/runTarget';
import type { LspRunnable } from '../runnables/runnable';
import { useTestResultsStore } from '../store/testResults';
import type { MainEntry } from '../syntax/contract';
import {
  buildMainRunCommand,
  buildRunCommand,
  capabilitiesFor,
  resolveRunContext,
} from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import { buildTestConfigId } from '../utils/testCommands';

import { MAX_CAPTURED_OUTPUT_CHARS, resolveRunCwd, type TestActionContext } from './context';
import { runnerFor } from './registry';
import { finalizeRunResults } from './results';

/**
 * 直跑用例命令，输出进 Task Console；结果流回填 gutter 状态。
 * 语言特有前置（Java 模块根/launcher/编译预检、Rust 清单）由 runner 提供。
 */
async function launchRun(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
  lsp: LspRunnable | null,
): Promise<void> {
  const runner = runnerFor(testCase.lang);
  const prep = await runner.prepareRun(ctx, testCase, runRoot);
  if (!prep) {
    // 阻断（通知已发）：结束 running 占位，避免 gutter 永久进行中
    useTestResultsStore.getState().invalidateFile(ctx.projectId, ctx.filePath);
    return;
  }
  // 语言可选富化（Java：`@Nested` 内层类链）。不改控制流：无该 hook / 降级失败 → 原样。
  const effectiveCase = (await runner.enrichTestCase?.(ctx, testCase)) ?? testCase;
  // IO（go.mod 探测 / Maven classpath 读取）收拢在 resolveRunContext，命令构造纯函数。
  const runCtx = await resolveRunContext(testCase.lang, ctx.filePath, prep.runRoot, {
    javaEnv: prep.javaEnv,
  });
  const command = buildRunCommand(
    effectiveCase,
    ctx.filePath,
    prep.manifestDir ?? null,
    prep.runRoot,
    runCtx,
    lsp,
  );
  let output = '';
  const runId = useTaskStore
    .getState()
    .runTask(command, buildTestConfigId('run', effectiveCase, ctx.filePath), {
      cwd: prep.runRoot,
      onOutput: (chunk) => {
        if (output.length < MAX_CAPTURED_OUTPUT_CHARS) output += chunk;
      },
      onExit: (exitCode: number) => {
        void finalizeRunResults(output, effectiveCase, ctx, prep.runRoot, { exitCode, command });
      },
    });
  if (!runId) {
    // 会话未能创建（如无活动项目）：结束 running 占位，避免图标永久卡在进行中
    useTestResultsStore.getState().invalidateFile(ctx.projectId, ctx.filePath);
    console.error('[TestRun] failed to start test task');
  }
}

/** Run：构造命令并经任务会话启动（前置 → 命令 → Task Console）。
 *  `lsp`：gutter marker 上带的 LSP runnable（tier ①），缺省走快路径启发式。 */
export function runTestCase(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  lsp: LspRunnable | null = null,
): void {
  void (async () => {
    const runRoot = resolveRunCwd(ctx);
    // Run 开始：清该文件旧状态并标记进行中（gutter 半透明占位）
    useTestResultsStore.getState().beginRun(ctx.projectId, ctx.filePath);
    await launchRun(testCase, ctx, runRoot, lsp);
  })();
}

/** main 入口 Run：Task Console 直跑（语言前置 + 命令均表驱动）。 */
export function runMain(
  entry: MainEntry,
  ctx: TestActionContext,
  lsp: LspRunnable | null = null,
): void {
  void (async () => {
    const cwd = resolveRunCwd(ctx);
    const prep = await runnerFor(entry.language).prepareMainRun(ctx, entry, cwd);
    if (!prep) return; // 阻断（通知已发；main 无 gutter 状态，无需清占位）
    const runCtx = await resolveRunContext(entry.language, ctx.filePath, prep.runRoot, {
      javaEnv: prep.javaEnv,
    });
    const command = buildMainRunCommand(entry.language, ctx.filePath, prep.runRoot, runCtx, {
      manifestDir: prep.manifestDir ?? null,
      lsp,
    });
    useTaskStore.getState().runTask(command, `main:${entry.language}:${ctx.filePath}`, {
      cwd: prep.runRoot,
      onOutput: () => {},
    });
  })();
}

/** Run 单一分发入口（测试用例与 main 共用）：test → runTestCase；main → runMain。 */
export function runTarget(target: RunTarget, ctx: TestActionContext): void {
  if (target.kind === 'test') {
    runTestCase(target.testCase, ctx, target.lsp ?? null);
  } else {
    runMain(target.entry, ctx, target.lsp ?? null);
  }
}

/**
 * Debug：pending 开面板 → 交注册表 runner（native：lldb/dlv；attach：Java jdwp）。
 * 无 Debug 能力的语言（如 TS）直接返回（UI 已隐藏按钮，防御兜底，非失败路径）。
 */
export function debugTarget(target: RunTarget, ctx: TestActionContext): void {
  const runner = runnerFor(targetLang(target));
  if (!capabilitiesFor(targetLang(target)).debug || !runner.debug) return;
  useDebugStore.getState().openPanel('console');
  void runner.debug(ctx, target);
}
