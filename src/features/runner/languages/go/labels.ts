/**
 * Go 的菜单文案（**本语言专属**：基准与用例的命令形态不同，文案随之区分）。
 *
 * 住在 `languages/go/` 而不是通用 `languages/labels.ts` 的原因：`benchmark` 是 Go 独有的概念
 * （`func BenchmarkXxx`，由 `TestCaseInfo.variant` 承载）。放进通用文案模块会让「新增语言」的人
 * 误以为它是通用形态，也削弱通用模块的内聚性。
 */
import type { RunTarget } from '../../runTarget';
import { mainDebugLabel, mainRunLabel, testDebugLabel, testRunLabel } from '../labels';

/** 基准 Run 项（Go `-bench`，与单测 `Test '<name>'` 同构）。 */
export function benchmarkRunLabel(name: string): string {
  return `Benchmark '${name}'`;
}

/** 基准 Debug 项（浮层次行）。 */
export function benchmarkDebugLabel(name: string): string {
  return `Debug 'Benchmark ${name}'`;
}

/** Go 的菜单文案：基准与用例形态不同（命令形态也不同，见 `commands.ts`），文案随之区分。 */
export function goLabels(target: RunTarget): { run: string; debug: string } {
  if (target.kind === 'main') return { run: mainRunLabel(), debug: mainDebugLabel() };
  const { name, variant } = target.testCase;
  if (variant === 'benchmark') {
    return { run: benchmarkRunLabel(name), debug: benchmarkDebugLabel(name) };
  }
  return { run: testRunLabel(name), debug: testDebugLabel(name) };
}
