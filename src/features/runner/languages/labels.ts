/**
 * gutter 浮层菜单的文案模板（语言无关的默认值 + Go 的基准变体）。
 *
 * 原先散在 `hooks/useRunActions` 里按 `testCase.variant === 'benchmark'` / `lang === 'go'` 分支选择；
 * 方案 B 阶段 4 下沉到语言侧：各语言用 [`defaultLabels`]，Go 覆盖成基准形态 —— 文案差异不再
 * 让通用 hook 认识任何语言。
 */
import type { RunTarget } from '../runTarget';

/** 用例 Run 项（JetBrains gutter 浮层首行）。 */
export function testRunLabel(name: string): string {
  return `Test '${name}'`;
}

/** 用例 Debug 项（浮层次行）。 */
export function testDebugLabel(name: string): string {
  return `Debug 'Test ${name}'`;
}

/** main Run 项（对齐单测惯例；main 函数名恒为 main）。 */
export function mainRunLabel(): string {
  return "Run 'main'";
}

/** main Debug 项（浮层次行）。 */
export function mainDebugLabel(): string {
  return "Debug 'main'";
}

/** 语言的默认菜单文案（用例 / 应用入口；Go 覆盖为基准变体）。 */
export function defaultLabels(target: RunTarget): { run: string; debug: string } {
  if (target.kind === 'main') return { run: mainRunLabel(), debug: mainDebugLabel() };
  return {
    run: testRunLabel(target.testCase.name),
    debug: testDebugLabel(target.testCase.name),
  };
}
