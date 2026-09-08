/**
 * 单测运行 gutter 贡献（editor 域自备；P3 起 testCodelensField 收归本模块内部）。
 *
 * 行号旁测试 Run/Debug gutter 图标（JetBrains/RustRover 原型风格）：
 * 每个测试用例行在统一 gutter 列（`cm-breakpoint-gutter`，断点列复用）显示
 * 单个绿色 play 图标，点击按语言分流：
 * - TS/JS 用例：直接 `onRun(testCase)`（无 Debug 能力，单项菜单无意义）；
 * - Rust 用例：`onMenuRequest(testCase, x, y)` → React 层在图标 rect 旁弹
 *   Run/Debug 浮层（x/y 为图标 `getBoundingClientRect()` 推导的锚点）。
 *
 * 点击路由由统一 gutter 列级委托处理（registry mousedown 经
 * `[data-gutter-contribution]` 显式命中 → onClick）；图标本体为纯视觉片段，
 * 不自吞事件，保证路由唯一。
 *
 * 性能红线：
 * - 挂载时同步解析一次（StateField.create）；doc 变更仅 map 现有 marker 位置，
 *   防抖（默认 ~300ms）后经 effect 触发一次全量重解析 —— 不每键全文件重解析。
 * - marker 经 RangeSetBuilder 惰性构建。
 * - 非 file tab 由装配层门控（贡献不注册）；非测试文件解析为空集。
 * - 本模块不注册独立 gutter 列：图标列由统一 gutter 提供，
 *   常驻 `cm-test-run-gutter` 空列已删除。
 */
import {
  Facet,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView, GutterMarker } from '@codemirror/view';

import { isTestFile, parseTestCases, type TestCaseInfo } from '../utils/testCases';

import type { GutterContribution, GutterHit, GutterLineContext } from './contribution';

/** Per-editor configuration injected via facet (fileName + click callbacks). */
export interface TestCodelensConfig {
  fileName: string;
  onRun: (testCase: TestCaseInfo) => void;
  /** Rust 用例点击 → 请求 React 层在图标 rect 旁（x/y 为 rect 推导锚点）打开 Run/Debug 浮层。 */
  onMenuRequest: (testCase: TestCaseInfo, x: number, y: number) => void;
}

export const testCodelensConfig = Facet.define<TestCodelensConfig, TestCodelensConfig>({
  combine: (configs) => configs[0],
});

/** Debounced reparse trigger (dispatched from the update listener after doc changes). */
export const refreshTestCodelensEffect = StateEffect.define<null>();

const DEFAULT_DEBOUNCE_MS = 300;

/** IDEA 风格 play 图标（lucide Play 路径，ISC；raw DOM marker 不便走 React 组件，内联 SVG 零依赖）。 */
const RUN_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

/** play 图标 DOM（纯视觉片段，无事件监听，路由见模块头）。 */
export function buildTestRunElement(testCase: TestCaseInfo): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-test-run-marker';
  el.title = testCase.lang === 'rust' || testCase.lang === 'go' ? 'Run or Debug test' : 'Run test';
  el.innerHTML = RUN_ICON_SVG;
  return el;
}

/** 用例行数据载体（field 缓存；合并器经 markersOf 读 testCase，不见 field）。 */
export class TestRunMarker extends GutterMarker {
  constructor(readonly testCase: TestCaseInfo) {
    super();
  }

  eq(other: TestRunMarker): boolean {
    return (
      other.testCase.name === this.testCase.name &&
      other.testCase.line === this.testCase.line &&
      other.testCase.lang === this.testCase.lang
    );
  }

  toDOM(): HTMLElement {
    return buildTestRunElement(this.testCase);
  }
}

/** 用例 → gutter markers（检测→marker 的纯装配，供 StateField 消费）。 */
function buildTestCodelensMarkers(state: EditorState): RangeSet<TestRunMarker> {
  const config = state.facet(testCodelensConfig);
  const docText = state.doc.toString();
  if (!isTestFile(config.fileName, docText)) return RangeSet.empty;
  const cases = parseTestCases(config.fileName, docText);
  if (cases.length === 0) return RangeSet.empty;

  const builder = new RangeSetBuilder<TestRunMarker>();
  for (const testCase of cases) {
    const line = state.doc.line(testCase.line);
    builder.add(line.from, line.from, new TestRunMarker(testCase));
  }
  return builder.finish();
}

export const testCodelensField = StateField.define<RangeSet<TestRunMarker>>({
  create: (state) => buildTestCodelensMarkers(state),
  update(markers, tr) {
    for (const e of tr.effects) {
      if (e.is(refreshTestCodelensEffect)) return buildTestCodelensMarkers(tr.state);
    }
    // Facet config change (file switch / callback swap) → immediate rebuild.
    if (tr.startState.facet(testCodelensConfig) !== tr.state.facet(testCodelensConfig)) {
      return buildTestCodelensMarkers(tr.state);
    }
    if (tr.docChanged) return markers.map(tr.changes);
    return markers;
  },
});

/** play 图标样式（gutter 列样式由统一 gutter 提供，本模块不再注册独立列）。 */
export const testCodelensCoreTheme = EditorView.theme({
  '.cm-test-run-marker': {
    width: '12px',
    height: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent-green, #98c379)',
  },
  '.cm-test-run-marker:hover': {
    filter: 'brightness(1.25)',
  },
  '.cm-test-run-marker svg': {
    width: '12px',
    height: '12px',
    display: 'block',
  },
});

/**
 * 测试用例检测核心扩展：仅装配 facet + field + 防抖重解析监听，
 * 不注册独立 gutter 列（图标列由统一 gutter `cm-breakpoint-gutter` 提供）。
 * 仅在测试文件启用（装配层门控）；非测试文件解析为空集。
 */
export function createTestCodelensCore(
  options: TestCodelensConfig & { debounceMs?: number },
): Extension {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: number | undefined;
  return [
    testCodelensConfig.of(options),
    testCodelensField,
    testCodelensCoreTheme,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        try {
          update.view.dispatch({ effects: refreshTestCodelensEffect.of(null) });
        } catch {
          // View destroyed between debounce scheduling and firing.
        }
      }, debounceMs);
    }),
  ];
}

export interface TestRunContributionOptions {
  /** TS/JS 用例点击直接运行（扩展内按 lang 分流，Rust 用例走 onMenuRequest）。 */
  onRun: (testCase: TestCaseInfo) => void;
  /** Rust 用例点击 → 请求打开 Run/Debug 浮层（x/y 为图标 rect 旁锚点）。 */
  onMenuRequest: (testCase: TestCaseInfo, x: number, y: number) => void;
}

/** 用例行枚举：读检测缓存 field（本函数不重解析）。 */
export function caseLinesOf(state: EditorState): number[] {
  try {
    const field = state.field(testCodelensField);
    const lines: number[] = [];
    const iter = field.iter();
    while (iter.value) {
      const lineNo = state.doc.lineAt(iter.from).number;
      if (!lines.includes(lineNo)) lines.push(lineNo);
      iter.next();
    }
    return lines;
  } catch {
    // 检测核心缺席（非测试文件 / 不可编辑 tab）→ 空集，退化为纯断点列。
    return [];
  }
}

/** 用例行 → TestCaseInfo（首个匹配；每行至多一个用例，见 parseTestCases）。 */
export function caseAtLine(state: EditorState, line: number): TestCaseInfo | null {
  try {
    const field = state.field(testCodelensField);
    const iter = field.iter();
    while (iter.value) {
      const lineNo = state.doc.lineAt(iter.from).number;
      if (lineNo === line) return iter.value.testCase;
      if (lineNo > line) break;
      iter.next();
    }
    return null;
  } catch {
    return null;
  }
}

export function createTestRunContribution(
  options: TestRunContributionOptions,
): GutterContribution<TestCaseInfo> {
  const { onRun, onMenuRequest } = options;
  return {
    id: 'test-run',
    priority: 20,

    when(ctx: GutterLineContext): boolean {
      // 与现行装配门控（useUnifiedGutter isTestOrRust + enabled）同语义：
      // fileName 无 docText 时 .rs 判 false，故显式保留 endsWith('.rs') 分支。
      return ctx.editable && (isTestFile(ctx.fileName) || ctx.fileName.endsWith('.rs'));
    },

    linesOf(state: EditorState): readonly number[] {
      return caseLinesOf(state);
    },

    markersOf(state: EditorState, line: number): { payload: TestCaseInfo } | null {
      const testCase = caseAtLine(state, line);
      return testCase ? { payload: testCase } : null;
    },

    render(hit: GutterHit<TestCaseInfo>): HTMLElement | null {
      const el = buildTestRunElement(hit.payload);
      el.setAttribute('data-gutter-contribution', 'test-run');
      return el;
    },

    onClick(hit: GutterHit<TestCaseInfo>): boolean {
      // TS 直跑；Rust/Go 走 rect 锚点菜单（菜单含 Run + Debug）。返回 true 吞掉，不冒泡给列级 toggle。
      if (hit.payload.lang === 'rust' || hit.payload.lang === 'go') {
        // 原型锚定：浮层紧贴图标（rect.right + 4 / rect.top），不用鼠标裸坐标。
        onMenuRequest(
          hit.payload,
          Math.round(hit.anchorRect.right + 4),
          Math.round(hit.anchorRect.top),
        );
      } else {
        onRun(hit.payload);
      }
      return true;
    },
  };
}
