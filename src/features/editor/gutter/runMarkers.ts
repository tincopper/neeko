/**
 * 可运行行的 **marker 层**：文档 → `RangeSet<RunMarker>`，含其外观（图标 + 主题）。
 *
 * 拆出理由：这是「一次同步、纯函数式的全量重建」这一关注点（性能红线所在），
 * 与装配层的交互路由（插件/事件/公共 API）变更原因不同。
 *
 * 性能红线（迁移后仍成立）：
 * - `StateField.create` 同步解析一次；doc 变更仅 `map` 现有 marker 位置，防抖后经 effect
 *   触发一次**全量重建** —— 不每键全文件重解析。
 * - marker 经 `RangeSetBuilder` 惰性构建。
 */
import { ensureSyntaxTree } from '@codemirror/language';
import { RangeSet, RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { EditorView, GutterMarker } from '@codemirror/view';

import {
  discoverRunTargets,
  hasMainEntries,
  isRunnableFile,
  isTestCaseFile,
  overlayKey,
  caseOverlaysFor,
  targetLang,
  targetLine,
  type LanguageOverlay,
  capabilitiesFor,
  type RunTarget,
} from '@/features/runner';

import { runCodelensConfig } from './runCodelensConfig';
import {
  lspRunnablesField,
  refreshRunCodelensEffect,
  setLspRunnablesEffect,
} from './runLspOverlay';

/** `ensureSyntaxTree` 的解析预算（ms）：超出即回落到整篇解析。 */
const SYNTAX_PARSE_BUDGET_MS = 50;

/** IDEA 风格 play 图标（lucide Play 路径，ISC；raw DOM marker 不便走 React 组件，内联 SVG 零依赖）。 */
const RUN_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

/** play 图标 DOM（纯视觉片段，无事件监听，路由见 `runContribution.ts` 模块头；测试与 main 同形同款）。 */
export function buildRunElement(target: RunTarget): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-run-marker';
  // 文案按**能力位**分流（`directRun` 语言只跑不调）：不再比较语言字面量。
  el.title = capabilitiesFor(targetLang(target)).directRun
    ? 'Run test'
    : target.kind === 'main'
      ? 'Run or Debug main'
      : 'Run or Debug test';
  el.innerHTML = RUN_ICON_SVG;
  return el;
}

/** 可运行行数据载体（field 缓存；合并器经 markersOf 读 target，不见 field）。 */
export class RunMarker extends GutterMarker {
  constructor(readonly target: RunTarget) {
    super();
  }

  eq(other: RunMarker): boolean {
    const a = this.target;
    const b = other.target;
    if (a.kind !== b.kind) return false;
    // 比较键只含**渲染相关**字段：`staticSubtests` 刻意不比 —— 它只影响菜单（点读当前
    // 目标），不影响图标/DOM；纳入比较反而会让「子测试变化」触发无谓的 marker 重建。
    if (a.kind === 'test' && b.kind === 'test') {
      return (
        a.testCase.name === b.testCase.name &&
        a.testCase.line === b.testCase.line &&
        a.testCase.lang === b.testCase.lang &&
        overlayKey(a) === overlayKey(b)
      );
    }
    if (a.kind === 'main' && b.kind === 'main') {
      return (
        a.entry.line === b.entry.line &&
        a.entry.language === b.entry.language &&
        overlayKey(a) === overlayKey(b)
      );
    }
    return false;
  }

  toDOM(): HTMLElement {
    return buildRunElement(this.target);
  }
}

/**
 * 可运行行 → gutter markers（测试 + main 两路检测合并，供 StateField 消费）。
 *
 * **语法树只取一次**：优先复用编辑器已解析的增量树 —— `ensureSyntaxTree` 保证「至少覆盖到
 * `upto`」，取不到（无语言挂载 / 超出预算）则返回 `null`，此时回落到 `discoverRunTargets`
 * 内部的**一次**整篇解析（两条路径都**不会重复解析**）。
 *
 * **刻意不用 `syntaxTree(state)`**：那是「可能不完整」的树（CM 按工作预算惰性解析，大文件
 * 初始可能只有视口附近有内容）→ 直接用它建 marker 会**静默漏掉**文件后半的用例/main。
 */
function buildTestCodelensMarkers(state: EditorState): RangeSet<RunMarker> {
  const config = state.facet(runCodelensConfig);
  // 语言能力（是否参与 / 是否有 main）来自注册表 —— 唯一事实源。
  if (!isRunnableFile(config.fileName)) return RangeSet.empty;
  const hasMain = hasMainEntries(config.fileName);

  const docText = state.doc.toString();
  // 测试门控按内容（rust `#[test]` / java `@Test` 需文档证据）；无证据跳过测试解析。
  const hasTests = isTestCaseFile(config.fileName, docText);
  if (!hasTests && !hasMain) return RangeSet.empty;

  const tree = ensureSyntaxTree(state, state.doc.length, SYNTAX_PARSE_BUDGET_MS) ?? undefined;
  const { tests, mains } = discoverRunTargets(config.fileName, docText, tree);

  // 两路检测的产出先按行号归并再建集：RangeSetBuilder 要求 from 递增，而
  // 「测试行」与「main 行」在同一文件可能交错（如 `fn main` 在 `#[test]` 之前），
  // 直接「测试后 main」顺序喂入会乱序 panic。
  const targets: RunTarget[] = [];
  if (hasTests) {
    // 父用例目标携带**语言自带的同步 overlay 载荷**（Go：静态子测试名，供菜单与运行时动态发现
    // 求差 —— 同一目标不给两个入口，设计 §7.8.4）。载荷结构归语言：本层只取不解释，
    // 未声明该 hook 的语言（TS/Rust/Java）天然得到空 Map。
    const caseOverlays = caseOverlaysFor(config.fileName, tests);
    for (const testCase of tests) {
      const overlay = caseOverlays.get(testCase.name);
      targets.push({ kind: 'test', testCase, ...(overlay === undefined ? {} : { overlay }) });
    }
  }
  if (hasMain) {
    for (const entry of mains) {
      targets.push({ kind: 'main', entry });
    }
  }
  targets.sort((a, b) => targetLine(a) - targetLine(b));

  // LSP 覆盖按行合并（tier ①）；缺失的行保持快路径 payload（tier ②）。
  const overlayByLine: Map<number, LanguageOverlay> =
    state.field(lspRunnablesField, false) ?? new Map<number, LanguageOverlay>();

  const builder = new RangeSetBuilder<RunMarker>();
  for (const target of targets) {
    const line = targetLine(target);
    // 行覆盖（Rust tier ①）优先；语言未提供 provider 时用同步载荷（Go 静态子测试）——
    // 两者结构上互斥（同一个语言不会既声明 provider 又声明 caseOverlays）。
    const overlay = overlayByLine.get(line) ?? target.overlay;
    const from = state.doc.line(line).from;
    builder.add(from, from, new RunMarker(overlay ? { ...target, overlay } : target));
  }
  return builder.finish();
}

export const runCodelensField = StateField.define<RangeSet<RunMarker>>({
  create: (state) => buildTestCodelensMarkers(state),
  update(markers, tr) {
    for (const e of tr.effects) {
      // LSP 覆盖注入（tier ①）同样需要重建 markers —— 否则 marker payload 里永远没有 lsp，
      // 点击时仍走快路径（覆盖"注入成功但没人消费"的静默失效）。
      if (e.is(refreshRunCodelensEffect) || e.is(setLspRunnablesEffect)) {
        return buildTestCodelensMarkers(tr.state);
      }
    }
    // Facet config change (file switch / callback swap) → immediate rebuild.
    if (tr.startState.facet(runCodelensConfig) !== tr.state.facet(runCodelensConfig)) {
      return buildTestCodelensMarkers(tr.state);
    }
    if (tr.docChanged) return markers.map(tr.changes);
    return markers;
  },
});

/** play 图标样式（gutter 列样式由统一 gutter 提供，本模块不注册独立列）。 */
export const runCodelensCoreTheme = EditorView.theme({
  '.cm-run-marker': {
    width: '12px',
    height: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent-green, #98c379)',
  },
  '.cm-run-marker:hover': {
    filter: 'brightness(1.25)',
  },
  '.cm-run-marker svg': {
    width: '12px',
    height: '12px',
    display: 'block',
  },
});
