/**
 * TS/JS run 命令与报告路径（纯函数）。
 *
 * 从 `utils/testCommands.ts` 迁入（方案 B 阶段 2）：报告路径与命令形态同源 —— 命令里写
 * `--outputFile.json=<报告>`、读取侧按同一常量取文件，故两者必须同住一个语言模块。
 */
import { shQuote } from '../../exec/shell';
import type { TestCaseInfo } from '../../syntax/contract';

/** vitest JSON 报告的 run 根下相对路径（读取侧与命令侧共用同一常量，保证路径一致）。 */
export const VITEST_REPORT_REL_PATH = 'node_modules/.neeko/vitest-report.json';

/** vitest JSON 报告绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildVitestReportPath(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${VITEST_REPORT_REL_PATH}` : VITEST_REPORT_REL_PATH;
}

/** TS/JS：default reporter 进 Task Console，json 落文件供 onExit 读取。 */
export function buildTsRunCommand(
  testCase: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
): string {
  return (
    `pnpm vitest run ${shQuote(relPath)} -t ${shQuote(testCase.name)}` +
    ` --reporter=default --reporter=json --outputFile.json=${shQuote(buildVitestReportPath(runRoot ?? ''))}`
  );
}
