/**
 * Java 结果读取（JUnit XML 报告）。
 *
 * 报告路径与命令形态同源（`commands.ts` 的 `--reports-dir` + `deriveJavaFqcn`），
 * 故 reader 与命令同住本目录；文件读取经注入的 `io.readText`（失败即空结果语义）。
 */
import { alignReportRows, parseJunitXml } from '../../utils/testResultParsers';
import type { ReadResultsInput, ReaderOutput } from '../contract';

import { JUNIT_REPORTS_REL_PATH, deriveJavaFqcn } from './commands';

/** 读 `<runRoot>/.neeko/junit-reports/TEST-<FQCN>.xml` → 对齐到源码用例名的结果。 */
export async function readJavaResults({
  testCase,
  ctx,
  cwd,
  io,
}: ReadResultsInput): Promise<ReaderOutput> {
  const fqcn = deriveJavaFqcn(ctx.filePath);
  const reportPath = `${JUNIT_REPORTS_REL_PATH}/TEST-${fqcn}.xml`;
  const xml = await io.readText(ctx.projectId, reportPath, cwd || null);
  if (!xml) return { results: [] }; // 报告缺失 / IPC 失败：不阻塞，仅清 running 态
  return { results: alignReportRows(parseJunitXml(xml), (row) => row.name, testCase.name) };
}
