/**
 * 运行结果读取与落库（Run 链路终点）：**语言自带 reader**（`LanguageModule.readResults`）。
 *
 * 本模块只剩编排：调 reader → store 落库 → 「0 命中」告警。报告格式、命名对齐规则、
 * 平台特例全在 `languages/<lang>/results.ts`（与命令形态同源）—— 通用层不再认识任何语言
 * （旧 `ResultsSource` 枚举与 `lang === 'rust'` 特例已随方案 B 阶段 2 删除）。
 */
import { useNotificationStore } from '@/shared/store/notificationStore';
import { IS_WINDOWS } from '@/shared/utils/platform';

import { runnerFor } from '../languages';
import type { ReaderOutput, RunOutcome } from '../languages/contract';
import { langIo } from '../languages/io';
import { useTestResultsStore } from '../store/testResults';
import type { TestCaseInfo } from '../syntax/contract';

import type { TestActionContext } from './context';

export type { RunOutcome };

/**
 * 是否应报告「命令成功（exit 0）但 0 个用例命中」。
 *
 * 前两条判据语言无关（命中 > 0 = 正常；退出码非 0 = Task Console 已有错误输出，重复报告是噪音）；
 * **语言可声明预期内的 0 命中**（Rust + Windows 本地 cmd 无结构化流 → 见
 * `languages/rust/results.ts::rustReportZeroMatch`）。
 *
 * `isWindows` 可注入（默认取平台常量）以便单测覆盖两个平台分支。
 */
export function shouldReportNoMatch(
  outcome: RunOutcome,
  matched: number,
  lang: Parameters<typeof runnerFor>[0],
  isWindows: boolean = IS_WINDOWS,
): boolean {
  if (matched > 0) return false;
  if (outcome.exitCode !== 0) return false;
  return runnerFor(lang).reportZeroMatch?.(matched, outcome, isWindows) ?? true;
}

/**
 * 解析 + 对齐 → store 落库（Run 链路终点）。
 * 空结果（编译失败 / 报告缺失）= 本次运行无状态可落，仅结束 running（不猜状态）；
 * 但「退出码 0 且 0 命中」属可疑静默失败，按 {@link shouldReportNoMatch} 显式告警。
 * Go 通道额外归并本次**动态发现的子测试全名**（供菜单单跑）——由 reader 一并产出。
 */
export async function finalizeRunResults(
  output: string,
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  cwd: string,
  outcome: RunOutcome,
): Promise<void> {
  const runner = runnerFor(testCase.lang);
  const { results, subtests }: ReaderOutput = runner.readResults
    ? await runner.readResults({ output, testCase, ctx, cwd, io: langIo })
    : { results: [] };
  const store = useTestResultsStore.getState();
  // 子测试发现先落（归并缓存，跨运行保留）；状态 upsert 后落（每次运行覆盖）。
  if (subtests && subtests.length > 0) {
    store.recordSubtests(ctx.projectId, ctx.filePath, testCase.name, subtests);
  }
  store.applyResults(ctx.projectId, ctx.filePath, results);
  if (shouldReportNoMatch(outcome, results.length, testCase.lang)) {
    const message =
      `No test cases matched '${testCase.name}' (exit code 0) — the filter or target may ` +
      `not cover this test.\nCommand: ${outcome.command}`;
    useNotificationStore.getState().addNotification({
      type: 'warning',
      title: 'Test Run',
      message,
    });
    console.warn('[TestRun] zero cases matched:', outcome.command);
  }
}
