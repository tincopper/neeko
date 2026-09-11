/**
 * 语言无关的**语法发现契约**（类型层）。
 *
 * 背景：所有语言的「从源码提取可运行目标」是同一个问题 —— 语言差异只在「测试/main 构造长什么样」，
 * 不在「如何取位置与名字」。故发现入口统一为 `SyntaxDoc → Target[]`，实现按语言拆分
 * （`syntax/<lang>.ts`），注册表（`utils/runLanguages.ts`）是唯一 seam。
 *
 * **类型归属**：目标形态 `TestCaseInfo` / `MainEntry` 由**本模块定义**（低层持有类型，
 * 上层 `utils/*` 再导出）—— 这样依赖方向单向（`utils → syntax`），不出现上下层互指。
 * 也不引入并行类型名：为同一概念起两个名字正是 code-reuse 指南「模式 5」的副本漂移隐患。
 */

export interface TestCaseInfo {
  name: string;
  /** 1-based line of the test declaration (attribute line for Rust/Java). */
  line: number;
  lang: 'ts' | 'rust' | 'go' | 'java';
  /**
   * Go：`test`（缺省）或 `benchmark`（`func BenchmarkXxx(b *testing.B)`，P2 新增）。
   * 只有 Go 有 benchmark 概念，其它语言保持缺省；命令构造 / 菜单文案据此分流。
   */
  kind?: 'test' | 'benchmark';
  /**
   * Java：`@Nested` **内层类简单名链**（外→内，**不含最外层类** —— 最外层由
   * `deriveJavaFqcn(relPath)` 提供，不重复携带以免双源漂移）。
   *
   * 唯一来源是**异步**的 LSP `textDocument/documentSymbol` 富化（`utils/javaDocumentSymbol`）；
   * 缺省 / 空数组 = 顶层用例，选择器与历史形态**逐字节一致**（LSP 不就绪时的降级路径）。
   */
  nestedClassPath?: string[];
}

/** 可运行语言（**派生自 `TestCaseInfo.lang`**，避免两个来源各列一份语言清单）。 */
export type RunLang = TestCaseInfo['lang'];

export type MainLang = 'go' | 'rust' | 'java';

export interface MainEntry {
  /** 1-based 行号（main 声明行）。 */
  line: number;
  language: MainLang;
}
import type { SyntaxTree } from './lezer';

/** 发现阶段的输入：语法树 + 原文 + 文件名（`fileName` 供语言判定与扩展名相关规则）。 */
export interface SyntaxDoc {
  tree: SyntaxTree;
  docText: string;
  fileName: string;
}
