/**
 * 语言模块的**域内查询面**：通用层（`exec/`、`store/`、渲染层）只经本模块问「哪个语言管这个
 * 文件 / 这门语言有什么能力 / 这个文件里有什么可运行目标」，不认识任何具体语言。
 *
 * 与 `registry.ts` 的分工：registry 是清单（谁存在），本模块是查询与分发（怎么用）。
 * 跨 feature 消费方（editor 渲染层）经 runner 门面拿到这里的导出。
 *
 * 依赖方向：本文件 → `languages/<lang>/`（清单方向）。**任何语言实现都不得反向依赖本文件**
 * 去读别语言的实现细节（架构护栏 7a 钉住语言目录之间互不 import）。
 */
import { targetLang, type RunTarget } from '../runTarget';
import { registerLanguageHooks } from '../store/languageHooks';
import type { MainEntry, RunLang, SyntaxDoc, TestCaseInfo } from '../syntax/contract';
import type { SyntaxTree } from '../syntax/lezer';
import { parserFor } from '../syntax/parsers';

import type { Discovered, LanguageOverlay, OverlayProvider, RunCapabilities } from './contract';
import { adapterHookFor, allRunners, runnerFor } from './registry';

export { allRunners, runnerFor } from './registry';

// 依赖反转：通用 store 不 import 本模块（会成环），改为在此把查询实现注入。
registerLanguageHooks({ adapterHookFor, all: allRunners });

/** 文件名 → 语言模块（无匹配 → null）。查找序 = 注册序（扩展名互斥，顺序无歧义）。 */
export function runLanguageFor(fileName: string) {
  return allRunners().find((module) => module.filePolicy.match(fileName)) ?? null;
}

/**
 * run / 测试状态 gutter 的**进列门控** —— 唯一事实源。
 * 两个 gutter 贡献与装配层都调本函数，`when` 语义不可能再各自漂移。
 */
export function isRunnableFile(fileName: string): boolean {
  return runLanguageFor(fileName) !== null;
}

/**
 * 文件是否承载**测试用例**（跨语言分发；语义比 `isRunnableFile` 更窄）。
 *
 * 各语言的判据由 `FilePolicy.isTestCaseFile` 声明：TS 按命名、Go 按 `_test.go`、
 * Rust/Java 需要内容证据（`#[test]` / `@Test`）。`docText` 缺失时要求内容证据的语言返回
 * `false`（保守：不解析无关文件）。
 */
export function isTestCaseFile(fileName: string, docText?: string): boolean {
  return runLanguageFor(fileName)?.filePolicy.isTestCaseFile(fileName, docText) ?? false;
}

/** 文件是否可能有 main 入口（供 markers 合并判定）。 */
export function hasMainEntries(fileName: string): boolean {
  return runLanguageFor(fileName)?.filePolicy.hasMain ?? false;
}

/**
 * **一次解析、两次发现**（gutter 的批量入口）。
 *
 * 存在理由：`discover` 若各路径各自整篇解析，同一文档会被**解析两遍**（实测在 179 KB Go
 * 文件里占一半以上成本）。本入口保证**最多解析一次**：调用方若已持有覆盖全文的树（编辑器
 * 增量树）则零解析。
 *
 * 门控语义与各语言能力位一致：`tests` 受 `isTestCaseFile` 约束、`mains` 受 `hasMain` 约束，
 * 故非目标文件自然得到空数组（单一来源，避免调用方各自判一遍）。
 */
export function discoverRunTargets(
  fileName: string,
  docText: string,
  tree?: SyntaxTree,
): Discovered {
  const module = runLanguageFor(fileName);
  if (!module) return { tests: [], mains: [] };
  // **先门控、后解析**：两路都不需要时不解析（避免「用不上也白解析全文」）。
  const wantsTests = module.filePolicy.isTestCaseFile(fileName, docText);
  const wantsMains = module.filePolicy.hasMain;
  if (!wantsTests && !wantsMains) return { tests: [], mains: [] };
  const sd: SyntaxDoc = { tree: tree ?? parserFor(module.id).parse(docText), docText, fileName };
  const discovered = module.discover(sd);
  return {
    tests: wantsTests ? discovered.tests : [],
    mains: wantsMains ? discovered.mains : [],
  };
}

/**
 * 由已发现的用例取「每用例的同步 overlay 载荷」（键 = 用例名）；语言未声明 → 空 Map。
 *
 * 与 `overlayProviderFor` 同一形态：通用层只问「该文件的语言给什么载荷」，不解释其结构。
 */
export function caseOverlaysFor(
  fileName: string,
  tests: readonly TestCaseInfo[],
): Map<string, LanguageOverlay> {
  return runLanguageFor(fileName)?.caseOverlays?.(tests) ?? new Map();
}

export function capabilitiesFor(lang: RunLang): RunCapabilities {
  return runnerFor(lang).capabilities;
}

/**
 * 文件所属语言的 overlay provider（tier ① 行覆盖来源）；无 → `null`（快路径照常）。
 *
 * 通用层只问「这个文件的 provider 是谁」——**不认识任何具体语言的协议**
 * （rust-analyzer `experimental/runnables` 的实现细节留在 `languages/rust/`）。
 */
export function overlayProviderFor(fileName: string): OverlayProvider | null {
  return runLanguageFor(fileName)?.overlayProvider ?? null;
}

/**
 * overlay 的稳定比较键（marker 的 `eq` 用，避免无谓重建 DOM）：**键规则由语言模块给**
 * （`LanguageModule.overlayKey`），本层只负责「取目标语言 → 委托」，不认识任何具体语言。
 *
 * 无 overlay / 语言未声明键函数 → 空串（未命中 tier ① 的行不参与比较，语义安全）。
 */
export function overlayKey(target: RunTarget): string {
  const overlay = target.overlay;
  if (overlay === undefined) return '';
  return runnerFor(targetLang(target)).overlayKey?.(overlay) ?? '';
}

export type { MainEntry, Discovered, RunCapabilities };
