/**
 * TS/JS 结果读取（vitest JSON 报告）。
 *
 * 报告路径与命令形态同源（`commands.ts` 的 `--outputFile.json`），故 reader 与命令同住本目录；
 * 文件读取经注入的 `io.readText`（失败即空结果语义）。
 */
import { alignReportRows, parseVitestJsonReport } from '../../utils/testResultParsers';
import type { ReadResultsInput, ReaderOutput } from '../contract';

import { VITEST_REPORT_REL_PATH } from './commands';

/** 读 `<runRoot>/node_modules/.neeko/vitest-report.json` → 对齐到源码用例名的结果。 */
export async function readTsResults({
  testCase,
  ctx,
  cwd,
  io,
}: ReadResultsInput): Promise<ReaderOutput> {
  const json = await io.readText(ctx.projectId, VITEST_REPORT_REL_PATH, cwd || null);
  if (!json) return { results: [] }; // 报告缺失 / IPC 失败：不阻塞，仅清 running 态
  return {
    results: alignReportRows(parseVitestJsonReport(json), (row) => row.fullName, testCase.name),
  };
}
