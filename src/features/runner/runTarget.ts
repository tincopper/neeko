/**
 * 可运行 gutter 的**输入契约与目标身份**（本层无内部依赖 → 其余模块与外部消费方都依赖它）。
 * 外部消费方（`runner/*`、`hooks/*`）需要 `RunTarget` / `targetLang` 时**直接导入本模块**。
 *
 * 拆出理由（`runContribution.ts` 曾有 442 行、混了 8 个关注点）：目标身份（`RunTarget` 及其
 * 行号/语言派生）与装配层（插件、事件、API）的**变更原因完全不同** —— 前者随「跑测语义」变，
 * 后者随「交互路由」变。放在一起会让任何一方改动都触碰同一文件。
 */
import type { LanguageOverlay } from './languages/contract';
import type { MainEntry, RunLang, TestCaseInfo } from './syntax/contract';

/**
 * 可运行目标：单测用例（kind='test'）或应用 main 入口（kind='main'）。
 * 显示/菜单/点击机制统一，仅动作层按 kind 分流（runTest/debugTest vs runMain/debugMain）。
 */
export type RunTarget =
  | {
      kind: 'test';
      testCase: TestCaseInfo;
      /**
       * 该用例**已被静态发现**的子测试全名（Go 表格子测试的逐行按钮产物，`<父>/<层级>`）。
       * 菜单据此与运行时动态发现求差：已有静态按钮的子测试不再重复列出（设计 §7.8.4）。
       * 缺省 = 无静态子测试（非 Go / 非表格 / 静态未覆盖），故不可用空数组代替。
       */
      subtests?: string[];
      /** 语言私有的运行时覆盖载荷（Rust：runnable）；通用层只透传，语义归所属语言。 */
      overlay?: LanguageOverlay;
    }
  | { kind: 'main'; entry: MainEntry; overlay?: LanguageOverlay };

/** 目标行号（marker 定位/eq 用）。 */
export function targetLine(target: RunTarget): number {
  return target.kind === 'test' ? target.testCase.line : target.entry.line;
}

/** 目标语言（菜单按 lang 分流，与既有测试菜单同语义）。 */
export function targetLang(target: RunTarget): RunLang {
  return target.kind === 'test' ? target.testCase.lang : target.entry.language;
}
