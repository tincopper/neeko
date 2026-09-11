/**
 * 运行结果读取与落库（Run 链路终点）：按注册表声明的**结果通道**择一解析。
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { IS_WINDOWS } from '@/shared/utils/platform';

import { useTestResultsStore, type AlignedCaseResult } from '../store/testResults';
import { resultsSourceFor, type ResultsSource, type RunLang } from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import {
  deriveJavaFqcn,
  JUNIT_REPORTS_REL_PATH,
  VITEST_REPORT_REL_PATH,
} from '../utils/testCommands';
import {
  collectSubtestNames,
  matchCaseName,
  parseJunitXml,
  parseLibtestJsonLines,
  parseTest2JsonLines,
  parseVitestJsonReport,
  type LibtestEvent,
} from '../utils/testResultParsers';

import type { TestActionContext } from './context';

/**
 * 结果读取器输出：对齐后的用例状态 + **本次运行动态发现的子测试全名**（可选）。
 * 只有 Go test2json 通道会产出 `subtests`（`t.Run` 的运行时全名）；其它通道省略。
 */
interface ReaderOutput {
  results: AlignedCaseResult[];
  subtests?: string[];
}

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
  ) => Promise<ReaderOutput>
> = {
  'libtest-json': (output, testCase) =>
    Promise.resolve({ results: alignLibtestResults(output, testCase) }),
  test2json: (output, testCase) => Promise.resolve(alignGoResults(output, testCase)),
  'junit-xml': async (_output, testCase, ctx, runRoot) => ({
    results: await readJunitResults(testCase, ctx, runRoot),
  }),
  'vitest-json': async (_output, testCase, ctx, runRoot) => ({
    results: await readVitestResults(testCase, ctx, runRoot),
  }),
};

/** Run 终态事实（「0 命中」诊断需要：退出码 + 实际执行的命令）。 */
export interface RunOutcome {
  exitCode: number;
  /** 实际执行的命令 —— 命中 0 时用户需要看到过滤器与 target 才能自助排查。 */
  command: string;
}

/**
 * 是否应报告「命令成功（exit 0）但 0 个用例命中」。
 *
 * 这是本模块唯一的**主动告警**判据，用于消灭静默失败：`cargo test '<name>'` 的
 * target/过滤器不覆盖该用例时（`examples/`、自定义 `[[test]]` path、`test = false`
 * 的目标、名称未对齐），命令 exit 0 却一个用例都没跑 —— 用户只看到 Task Console
 * 有输出、gutter 无状态，无从判断问题在哪。
 *
 * 两类**预期内**的 0 命中不报：
 * - 退出码非 0（编译/运行失败）：Task Console 已有错误输出，重复报告是噪音；
 * - Windows 本地 Rust：`cmd.exe` 不支持 `VAR=x cmd` 前缀，libtest JSON 结构化流
 *   本就不产出（`testCommands.ts` 已声明限制），此时 0 命中是已知行为。
 *
 * `isWindows` 可注入（默认取平台常量）以便单测覆盖两个平台分支。
 */
export function shouldReportNoMatch(
  outcome: RunOutcome,
  matched: number,
  lang: RunLang,
  isWindows: boolean = IS_WINDOWS,
): boolean {
  if (matched > 0) return false;
  if (outcome.exitCode !== 0) return false;
  if (isWindows && lang === 'rust') return false;
  return true;
}

/**
 * 解析 + 对齐 → store 落库（Run 链路终点）。
 * 空结果（编译失败 / 报告缺失）= 本次运行无状态可落，仅结束 running（不猜状态）；
 * 但「退出码 0 且 0 命中」属可疑静默失败，按 {@link shouldReportNoMatch} 显式告警。
 * Go 通道额外归并本次**动态发现的子测试全名**（P3，供菜单单跑）。
 */
export async function finalizeRunResults(
  output: string,
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
  outcome: RunOutcome,
): Promise<void> {
  const { results, subtests } = await RESULT_READERS[resultsSourceFor(testCase.lang)](
    output,
    testCase,
    ctx,
    runRoot,
  );
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

/** go test2json 行 → 对齐到源码用例名的结果 + 动态发现的子测试全名。 */
function alignGoResults(output: string, testCase: TestCaseInfo): ReaderOutput {
  const events = parseTest2JsonLines(output);
  return {
    results: alignEvents(events, testCase),
    // benchmark 的 `b.Run` 子基准不在本期范围（发现缓存只服务用例菜单），故不发现。
    subtests: testCase.kind === 'benchmark' ? [] : collectSubtestNames(events, testCase.name),
  };
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
