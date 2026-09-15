/**
 * Rust 结果读取（libtest JSON 行）+ 「0 命中」判定。
 *
 * 报告格式与命令形态同源（`commands.ts` 里的 `--format=json`），故 reader 与命令同住本目录。
 */
import { alignEvents, parseLibtestJsonLines } from '../../utils/testResultParsers';
import type { ReadResultsInput, ReaderOutput, RunOutcome } from '../contract';

/** libtest JSON 行 → 对齐到源码用例名的结果。 */
export async function readRustResults({
  output,
  testCase,
}: ReadResultsInput): Promise<ReaderOutput> {
  return { results: alignEvents(parseLibtestJsonLines(output), testCase.name) };
}

/**
 * Windows 本地 Rust 的 0 命中**不报告**：`cmd.exe` 不支持 `VAR=x cmd` 前缀语法，
 * `RUSTC_BOOTSTRAP=1 cargo test …` 结构化输出本就不产出（见 `commands.ts` 声明）——
 * 此时「0 命中」是已知行为，报出来只是噪音。
 */
export function rustReportZeroMatch(
  _matched: number,
  _outcome: RunOutcome,
  hostIsWindows: boolean,
): boolean {
  return !hostIsWindows;
}
