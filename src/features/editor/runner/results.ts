/**
 * 运行结果读取与落库（Run 链路终点）：按注册表声明的**结果通道**择一解析。
 */
import { readFileContent } from '@/features/file/api/fileApi';

import { useTestResultsStore, type AlignedCaseResult } from '../store/testResults';
import { resultsSourceFor, type ResultsSource } from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import {
  deriveJavaFqcn,
  JUNIT_REPORTS_REL_PATH,
  VITEST_REPORT_REL_PATH,
} from '../utils/testCommands';
import {
  matchCaseName,
  parseJunitXml,
  parseLibtestJsonLines,
  parseTest2JsonLines,
  parseVitestJsonReport,
  type LibtestEvent,
} from '../utils/testResultParsers';

import type { TestActionContext } from './context';

/**
 * 结果读取器：按**结果通道**（注册表 `RunLanguage.results` 声明）择一，
 * 不再按语言分支 —— 通道是「产物格式」这一真实维度，同格式语言天然共享。
 * stdout 事件流（libtest / test2json）纯解析；junit / vitest 读报告文件（需 ctx/runRoot）。
 */
const RESULT_READERS: Record<
  ResultsSource,
  (
    output: string,
    testCase: TestCaseInfo,
    ctx: TestActionContext,
    runRoot: string,
  ) => Promise<AlignedCaseResult[]>
> = {
  'libtest-json': (output, testCase) => Promise.resolve(alignLibtestResults(output, testCase)),
  test2json: (output, testCase) => Promise.resolve(alignGoResults(output, testCase)),
  'junit-xml': (_output, testCase, ctx, runRoot) => readJunitResults(testCase, ctx, runRoot),
  'vitest-json': (_output, testCase, ctx, runRoot) => readVitestResults(testCase, ctx, runRoot),
};

/**
 * 解析 + 对齐 → store 落库（Run 链路终点）。
 * 空结果（编译失败 / 报告缺失）= 本次运行无状态可落，仅结束 running（不猜状态）。
 */
export async function finalizeRunResults(
  output: string,
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
): Promise<void> {
  const results = await RESULT_READERS[resultsSourceFor(testCase.lang)](
    output,
    testCase,
    ctx,
    runRoot,
  );
  useTestResultsStore.getState().applyResults(ctx.projectId, ctx.filePath, results);
}

/** 事件流 → 对齐到源码用例名的结果（matchCaseName 拒绝无边界/参数化名）。 */
function alignEvents(events: LibtestEvent[], testCase: TestCaseInfo): AlignedCaseResult[] {
  const results: AlignedCaseResult[] = [];
  for (const event of events) {
    if (!matchCaseName(event.name, testCase.name)) continue;
    results.push({
      caseName: testCase.name,
      status: event.status,
      ...(event.duration !== undefined ? { duration: event.duration } : {}),
      ...(event.stdout !== undefined ? { message: event.stdout } : {}),
    });
  }
  return results;
}

/** libtest JSON 行 → 对齐到源码用例名的结果。 */
function alignLibtestResults(output: string, testCase: TestCaseInfo): AlignedCaseResult[] {
  return alignEvents(parseLibtestJsonLines(output), testCase);
}

/** go test2json 行 → 对齐到源码用例名的结果。 */
function alignGoResults(output: string, testCase: TestCaseInfo): AlignedCaseResult[] {
  return alignEvents(parseTest2JsonLines(output), testCase);
}

/**
 * vitest JSON 报告读取 + 对齐。报告位于 run 根下 `node_modules/.neeko/vitest-report.json`
 * （与命令侧 `--outputFile.json` 同根：命令用绝对路径、读取用「run 根 + 相对路径」，
 * 本地 join 与 WSL/SSH shell 拼接两通道均成立）。读取失败静默跳过（空结果语义）。
 */
async function readVitestResults(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
): Promise<AlignedCaseResult[]> {
  try {
    const report = await readFileContent(ctx.projectId, VITEST_REPORT_REL_PATH, runRoot || null);
    return parseVitestJsonReport(report.content)
      .filter((r) => matchCaseName(r.fullName, testCase.name))
      .map((r) => ({
        caseName: testCase.name,
        status: r.status,
        ...(r.duration !== undefined ? { duration: r.duration } : {}),
        ...(r.message !== undefined ? { message: r.message } : {}),
      }));
  } catch {
    return []; // 报告缺失 / IPC 失败：不阻塞，仅清 running 态（Task Console 有原始输出）
  }
}

/**
 * JUnit XML 报告读取 + 对齐（仿 vitest 报告通道）。报告位于 run 根下
 * `.neeko/junit-reports/TEST-<FQCN>.xml`（Console Launcher `--reports-dir` 落盘，
 * Surefire/Gradle 兼容格式；FQCN 与命令侧 deriveJavaFqcn 同源推导——同一文件的
 * 命令与读取路径天然一致）。读取失败静默跳过（空结果语义）。
 */
async function readJunitResults(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
): Promise<AlignedCaseResult[]> {
  try {
    const fqcn = deriveJavaFqcn(ctx.filePath);
    const reportPath = `${JUNIT_REPORTS_REL_PATH}/TEST-${fqcn}.xml`;
    const report = await readFileContent(ctx.projectId, reportPath, runRoot || null);
    return parseJunitXml(report.content)
      .filter((r) => matchCaseName(r.name, testCase.name))
      .map((r) => ({
        caseName: testCase.name,
        status: r.status,
        ...(r.duration !== undefined ? { duration: r.duration } : {}),
        ...(r.message !== undefined ? { message: r.message } : {}),
      }));
  } catch {
    return []; // 报告缺失 / IPC 失败：不阻塞，仅清 running 态（Task Console 有原始输出）
  }
}
