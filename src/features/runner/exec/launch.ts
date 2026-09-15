/**
 * Run/Debug 动作入口：**表驱动**每语言前置（`languages/registry`）+ 任务会话编排。
 *
 * - Run：语言模块算完**计划**（探测 / 预检 / 环境 / 命令 → `RunPlan`）→
 *   `taskStore.runTask` 进 Task Console；onExit 后按结果通道解析回填 gutter。
 * - Debug：能力声明放行（`capabilities.debug`）→ 语言模块的 `planDebug`
 *   （native：无头构建 → 产物解析 → lldb/dlv；attach：Java jdwp）。
 *
 * 本模块**不含任何语言的**前置与命令细节，也不持有语言专属的中间产物（旧 `RunPreparation` /
 * `RunContext` 已随方案 B 消失）：语言差异全在 `languages/<lang>/`。
 *
 * IO 经 `langIo` 注入给语言模块（生产实现；单测可注入 fake）。
 */
import { useDebugStore } from '@/features/runner/store/debugStore';
import { useTaskStore } from '@/shared/store/taskStore';

import { capabilitiesFor, runnerFor } from '../languages';
import type { LanguageOverlay } from '../languages/contract';
import { langIo } from '../languages/io';
import { targetLang, type RunTarget } from '../runTarget';
import { useTestResultsStore } from '../store/testResults';
import type { MainEntry, TestCaseInfo } from '../syntax/contract';

import { MAX_CAPTURED_OUTPUT_CHARS, resolveRunCwd, type TestActionContext } from './context';
import { finalizeRunResults } from './results';

/**
 * 直跑用例命令，输出进 Task Console；结果流回填 gutter 状态。
 * 语言特有前置（Java 模块根/launcher/编译预检、Rust 清单、Go 包目录）由语言模块的计划提供。
 */
async function launchRun(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
  lsp: LanguageOverlay | null,
): Promise<void> {
  const plan = await runnerFor(testCase.lang).planTestRun({
    ctx,
    testCase,
    runRoot,
    overlay: lsp ?? undefined,
    io: langIo,
  });
  if (!plan) {
    // 阻断（语言模块已发通知）：结束 running 占位，避免 gutter 永久进行中
    useTestResultsStore.getState().invalidateFile(ctx.projectId, ctx.filePath);
    return;
  }
  let output = '';
  const runId = useTaskStore.getState().runTask(plan.command, plan.configId, {
    cwd: plan.cwd,
    onOutput: (chunk) => {
      if (output.length < MAX_CAPTURED_OUTPUT_CHARS) output += chunk;
    },
    onExit: (exitCode: number) => {
      void finalizeRunResults(output, testCase, ctx, plan.cwd, {
        exitCode,
        command: plan.command,
      });
    },
  });
  if (!runId) {
    // 会话未能创建（如无活动项目）：结束 running 占位，避免图标永久卡在进行中
    useTestResultsStore.getState().invalidateFile(ctx.projectId, ctx.filePath);
    console.error('[TestRun] failed to start test task');
  }
}

/** Run：构造命令并经任务会话启动（语言计划 → Task Console）。
 *  `lsp`：gutter marker 上带的 LSP runnable（tier ①），缺省走快路径启发式。 */
export function runTestCase(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  lsp: LanguageOverlay | null = null,
): void {
  void (async () => {
    const runRoot = resolveRunCwd(ctx);
    // Run 开始：清该文件旧状态并标记进行中（gutter 半透明占位）
    useTestResultsStore.getState().beginRun(ctx.projectId, ctx.filePath);
    await launchRun(testCase, ctx, runRoot, lsp);
  })();
}

/** main 入口 Run：Task Console 直跑（语言计划表驱动）。 */
export function runMain(
  entry: MainEntry,
  ctx: TestActionContext,
  lsp: LanguageOverlay | null = null,
): void {
  void (async () => {
    const runRoot = resolveRunCwd(ctx);
    const plan = await runnerFor(entry.language).planMainRun({
      ctx,
      entry,
      runRoot,
      overlay: lsp ?? undefined,
      io: langIo,
    });
    if (!plan) return; // 阻断（通知已发；main 无 gutter 状态，无需清占位）
    useTaskStore.getState().runTask(plan.command, plan.configId, {
      cwd: plan.cwd,
      onOutput: () => {},
    });
  })();
}

/** Run 单一分发入口（测试用例与 main 共用）：test → runTestCase；main → runMain。 */
export function runTarget(target: RunTarget, ctx: TestActionContext): void {
  if (target.kind === 'test') {
    runTestCase(target.testCase, ctx, target.overlay ?? null);
  } else {
    runMain(target.entry, ctx, target.overlay ?? null);
  }
}

/**
 * Debug：pending 开面板 → 交语言模块（native：lldb/dlv；attach：Java jdwp）。
 * 无 Debug 能力的语言（如 TS）直接返回（UI 已隐藏按钮，防御兜底，非失败路径）。
 */
export function debugTarget(target: RunTarget, ctx: TestActionContext): void {
  const lang = targetLang(target);
  const runner = runnerFor(lang);
  if (!capabilitiesFor(lang).debug || !runner.planDebug) return;
  useDebugStore.getState().openPanel('console');
  void runner.planDebug({ ctx, target, io: langIo });
}
