/**
 * Go 结果读取（`go test -json` 事件流）——含子测试的动态发现。
 *
 * 报告格式与命令形态同源（`commands.ts` 的 `-json`），故 reader 与命令同住本目录。
 */
import {
  alignEvents,
  collectGoSubtestNames,
  parseTest2JsonLines,
} from '../../utils/testResultParsers';
import type { ReadResultsInput, ReaderOutput } from '../contract';

/** test2json 行 → 对齐结果 + 本次**实际执行**的子测试全名（供菜单单跑）。 */
export async function readGoResults({ output, testCase }: ReadResultsInput): Promise<ReaderOutput> {
  const events = parseTest2JsonLines(output);
  return {
    results: alignEvents(events, testCase.name),
    // benchmark 的 `b.Run` 子基准不在本期范围（发现缓存只服务用例菜单），故不发现。
    subtests: testCase.variant === 'benchmark' ? [] : collectGoSubtestNames(events, testCase.name),
  };
}
