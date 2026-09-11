/**
 * 单测 / main 运行 gutter 贡献（editor 域自备；P3 起 runCodelensField 收归本模块内部）。
 *
 * 行号旁 Run/Debug gutter 图标（JetBrains/RustRover 原型风格）：测试用例行与
 * **main 入口行共用同一套显示/点击机制**（同一 play 图标、同一 field、同一主题、
 * 同一浮层路由）——main 不是第二套实现，只是检测源多了一路 `parseMainEntries`。
 * 每个可运行行在统一 gutter 列（`cm-breakpoint-gutter`，断点列复用）显示单个
 * 绿色 play 图标，点击按语言分流：
 * - TS/JS 用例：直接 `onRun(target)`（无 Debug 能力，单项菜单无意义）；
 * - Rust/Go/Java（测试与 main 皆然）：`onMenuRequest(target, x, y)` → React 层在
 *   图标 rect 旁弹 Run/Debug 浮层（x/y 为图标 `getBoundingClientRect()` 推导锚点）。
 *   Java Debug 为 J3 attach-first（JavaAdapter），Go 走 dlv mode:exec。
 *
 * 点击路由由统一 gutter 列级委托处理（registry mousedown 经
 * `[data-gutter-contribution]` 显式命中 → onClick）；图标本体为纯视觉片段，
 * 不自吞事件，保证路由唯一。
 *
 * 性能红线：
 * - 挂载时同步解析一次（StateField.create）；doc 变更仅 map 现有 marker 位置，
 *   防抖（默认 ~300ms）后经 effect 触发一次全量重解析 —— 不每键全文件重解析。
 * - marker 经 RangeSetBuilder 惰性构建。
 * - 非 file tab 由装配层门控（贡献不注册）；测试/main 检测各自返回空即空集。
 * - 本模块不注册独立 gutter 列：图标列由统一 gutter 提供，
 *   常驻 `cm-run-gutter` 空列已删除。
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
import { EditorView, GutterMarker, ViewPlugin } from '@codemirror/view';

import {
  fetchRunnablesForLines,
  isRustAnalyzerReady,
  type RunnableLineTarget,
} from '../runnables/provider';
import type { LspRunnable } from '../runnables/runnable';
import { type MainEntry } from '../utils/mainEntries';
import {
  capabilitiesFor,
  hasMainEntries,
  isRunnableFile,
  parseMainEntries,
  parseTestCases,
} from '../utils/runLanguages';
import { isTestFile, type TestCaseInfo } from '../utils/testCases';

import type { GutterContribution, GutterHit, GutterLineContext } from './contribution';

/**
 * 可运行目标：单测用例（kind='test'）或应用 main 入口（kind='main'）。
 * 显示/菜单/点击机制统一，仅动作层按 kind 分流（runTest/debugTest vs runMain/debugMain）。
 */
export type RunTarget =
  | { kind: 'test'; testCase: TestCaseInfo; lsp?: LspRunnable }
  | { kind: 'main'; entry: MainEntry; lsp?: LspRunnable };

/** RunTarget 的 LSP 覆盖在 marker 层的稳定比较键（避免无谓重建 DOM）。 */
function lspKey(target: RunTarget): string {
  const lsp = target.lsp;
  if (!lsp) return '';
  return `${lsp.label}|${(lsp.args.cargoArgs ?? []).join(' ')}|${(lsp.args.executableArgs ?? []).join(' ')}`;
}

/** 目标行号（marker 定位/eq 用）。 */
export function targetLine(target: RunTarget): number {
  return target.kind === 'test' ? target.testCase.line : target.entry.line;
}

/** 目标语言（菜单按 lang 分流，与既有测试菜单同语义）。 */
export function targetLang(target: RunTarget): 'ts' | 'go' | 'rust' | 'java' {
  return target.kind === 'test' ? target.testCase.lang : target.entry.language;
}

/** Per-editor configuration injected via facet (fileName + click callbacks). */
export interface RunCodelensConfig {
  fileName: string;
  /** LSP runnable 拉取所需的项目上下文（缺省则跳过 tier ①，只走快路径）。 */
  projectId?: string;
  /** 被编辑文件绝对路径（`file://` uri 构造）。 */
  absFilePath?: string;
  /** LSP 会话键（项目根 / worktree 根）。 */
  projectPath?: string | null;
  onRun: (target: RunTarget) => void;
  /** Rust/Go/Java（测试与 main 皆然）点击 → 请求 React 层在图标 rect 旁（x/y 为 rect
   *  推导锚点）打开 Run/Debug 浮层。 */
  onMenuRequest: (target: RunTarget, x: number, y: number) => void;
}

export const runCodelensConfig = Facet.define<RunCodelensConfig, RunCodelensConfig>({
  combine: (configs) => configs[0],
});

/** Debounced reparse trigger (dispatched from the update listener after doc changes). */
export const refreshRunCodelensEffect = StateEffect.define<null>();

/**
 * LSP runnable 覆盖（行号 1-based → runnable），由**异步** provider 注入。
 *
 * 刻意做成 StateField 而不是读全局 store/闭包：快路径 markers 的构建（`StateField.create`）
 * 必须保持**同步纯函数**，异步结果只能在就绪后经 effect 落进来。
 */
export const setLspRunnablesEffect = StateEffect.define<Map<number, LspRunnable>>();

export const lspRunnablesField = StateField.define<Map<number, LspRunnable>>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setLspRunnablesEffect)) return e.value;
    }
    return value;
  },
});

const DEFAULT_DEBOUNCE_MS = 300;

/** IDEA 风格 play 图标（lucide Play 路径，ISC；raw DOM marker 不便走 React 组件，内联 SVG 零依赖）。 */
const RUN_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

/** play 图标 DOM（纯视觉片段，无事件监听，路由见模块头；测试与 main 同形同款）。 */
export function buildRunElement(target: RunTarget): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-run-marker';
  el.title =
    targetLang(target) === 'ts'
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
    if (a.kind === 'test' && b.kind === 'test') {
      return (
        a.testCase.name === b.testCase.name &&
        a.testCase.line === b.testCase.line &&
        a.testCase.lang === b.testCase.lang &&
        lspKey(a) === lspKey(b)
      );
    }
    if (a.kind === 'main' && b.kind === 'main') {
      return (
        a.entry.line === b.entry.line &&
        a.entry.language === b.entry.language &&
        lspKey(a) === lspKey(b)
      );
    }
    return false;
  }

  toDOM(): HTMLElement {
    return buildRunElement(this.target);
  }
}

/** 可运行行 → gutter markers（测试 + main 两路检测合并，供 StateField 消费）。 */
function buildTestCodelensMarkers(state: EditorState): RangeSet<RunMarker> {
  const config = state.facet(runCodelensConfig);
  // 语言能力（是否参与 / 是否有 main）来自注册表 —— 唯一事实源。
  if (!isRunnableFile(config.fileName)) return RangeSet.empty;
  const hasMain = hasMainEntries(config.fileName);

  const docText = state.doc.toString();
  // 测试门控按内容（rust `#[test]` / java `@Test` 需文档证据）；无证据跳过测试解析。
  const hasTests = isTestFile(config.fileName, docText);
  if (!hasTests && !hasMain) return RangeSet.empty;

  // 两路检测的产出先按行号归并再建集：RangeSetBuilder 要求 from 递增，而
  // 「测试行」与「main 行」在同一文件可能交错（如 `fn main` 在 `#[test]` 之前），
  // 直接「测试后 main」顺序喂入会乱序 panic。
  const targets: RunTarget[] = [];
  if (hasTests) {
    for (const testCase of parseTestCases(config.fileName, docText)) {
      targets.push({ kind: 'test', testCase });
    }
  }
  if (hasMain) {
    for (const entry of parseMainEntries(config.fileName, docText)) {
      targets.push({ kind: 'main', entry });
    }
  }
  targets.sort((a, b) => targetLine(a) - targetLine(b));

  // LSP 覆盖按行合并（tier ①）；缺失的行保持快路径 payload（tier ②）。
  const lspByLine = state.field(lspRunnablesField, false) ?? new Map<number, LspRunnable>();

  const builder = new RangeSetBuilder<RunMarker>();
  for (const target of targets) {
    const line = targetLine(target);
    const lsp = lspByLine.get(line);
    const from = state.doc.line(line).from;
    builder.add(from, from, new RunMarker(lsp ? { ...target, lsp } : target));
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

/**
 * 可运行检测核心扩展：仅装配 facet + field + 防抖重解析监听，
 * 不注册独立 gutter 列（图标列由统一 gutter `cm-breakpoint-gutter` 提供）。
 * 测试文件或 .go/.rs/.java 文件启用（装配层门控）；无目标解析为空集。
 */
/**
 * 异步拉取 LSP runnable 并注入 field（tier ①）。**只在 rust 文件 + RA 就绪时**发起；
 * 任何失败/未命中静默跳过（快路径结果原样保留）。派发前校验目标集合未变，避免陈旧覆盖。
 */
async function loadLspRunnables(view: EditorView): Promise<void> {
  const config = view.state.facet(runCodelensConfig);
  const { projectId, absFilePath, projectPath, fileName } = config;
  if (!projectId || !absFilePath || !projectPath) return;
  // tier ① 目前只接 rust-analyzer（Go/Java 见 design/runnable-detection.md §6 P2）。
  if (!fileName.endsWith('.rs') || !isRustAnalyzerReady(projectPath)) return;

  const targets: RunnableLineTarget[] = [];
  for (const line of runLinesOf(view.state)) {
    const target = runAtLine(view.state, line);
    if (target) targets.push({ line, kind: target.kind });
  }
  if (targets.length === 0) return;

  const signature = targets.map((t) => `${t.line}:${t.kind}`).join(',');
  const overlay = await fetchRunnablesForLines({
    projectId,
    projectPath,
    absFilePath,
    targets,
  });
  if (overlay.size === 0) return;

  // 目标集合已变化（编辑中）→ 丢弃本次结果，等防抖后的下一轮。
  const stillValid =
    runLinesOf(view.state)
      .map((line) => {
        const target = runAtLine(view.state, line);
        return target ? `${line}:${target.kind}` : '';
      })
      .filter((s) => s !== '')
      .join(',') === signature;
  if (!stillValid) return;

  try {
    view.dispatch({ effects: setLspRunnablesEffect.of(overlay) });
  } catch {
    // View destroyed while awaiting LSP（与防抖分支同处理）。
  }
}

/** 挂载时拉一次（构造期只排异步任务，不派发 —— 避免 "update in progress" 限制）。 */
const lspRunnablesLoader = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      void loadLspRunnables(view);
    }
  },
);

export function createRunCodelensCore(
  options: RunCodelensConfig & { debounceMs?: number },
): Extension {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: number | undefined;
  return [
    runCodelensConfig.of(options),
    runCodelensField,
    lspRunnablesField,
    runCodelensCoreTheme,
    lspRunnablesLoader,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        try {
          update.view.dispatch({ effects: refreshRunCodelensEffect.of(null) });
          // 快路径重建后再补一次 tier ①（异步，不阻塞 markers）。
          void loadLspRunnables(update.view);
        } catch {
          // View destroyed between debounce scheduling and firing.
        }
      }, debounceMs);
    }),
  ];
}

export interface RunContributionOptions {
  /** TS/JS 用例点击直接运行（扩展内按 lang 分流，Rust/Go/Java 走 onMenuRequest）。 */
  onRun: (target: RunTarget) => void;
  /** Rust/Go/Java（测试与 main 皆然）点击 → 请求打开 Run/Debug 浮层（rect 锚点）。 */
  onMenuRequest: (target: RunTarget, x: number, y: number) => void;
}

/** 可运行行枚举：读检测缓存 field（本函数不重解析）。 */
export function runLinesOf(state: EditorState): number[] {
  try {
    const field = state.field(runCodelensField);
    const lines: number[] = [];
    const iter = field.iter();
    while (iter.value) {
      const lineNo = state.doc.lineAt(iter.from).number;
      if (!lines.includes(lineNo)) lines.push(lineNo);
      iter.next();
    }
    return lines;
  } catch {
    // 检测核心缺席（非可运行文件 / 不可编辑 tab）→ 空集，退化为纯断点列。
    return [];
  }
}

/** 可运行行 → RunTarget（首个匹配；每行至多一个目标，测试/main 各自不重叠）。 */
export function runAtLine(state: EditorState, line: number): RunTarget | null {
  try {
    const field = state.field(runCodelensField);
    const iter = field.iter();
    while (iter.value) {
      const lineNo = state.doc.lineAt(iter.from).number;
      if (lineNo === line) return iter.value.target;
      if (lineNo > line) break;
      iter.next();
    }
    return null;
  } catch {
    return null;
  }
}

export function createRunContribution(
  options: RunContributionOptions,
): GutterContribution<RunTarget> {
  const { onRun, onMenuRequest } = options;
  return {
    id: 'run',
    priority: 20,

    when(ctx: GutterLineContext): boolean {
      // 进列门控唯一事实源（runLanguages）：与 test-status 贡献、装配层同源，
      // markers 再按 docText 收窄。
      return ctx.editable && isRunnableFile(ctx.fileName);
    },

    linesOf(state: EditorState): readonly number[] {
      return runLinesOf(state);
    },

    markersOf(state: EditorState, line: number): { payload: RunTarget } | null {
      const target = runAtLine(state, line);
      return target ? { payload: target } : null;
    },

    render(hit: GutterHit<RunTarget>): HTMLElement | null {
      const el = buildRunElement(hit.payload);
      el.setAttribute('data-gutter-contribution', 'run');
      return el;
    },

    onClick(hit: GutterHit<RunTarget>): boolean {
      // 直跑 vs 菜单由注册表能力声明驱动（`directRun`），不再按 lang 字符串判断。
      // 菜单含 Run + Debug（Debug 通道由同一注册表的 `debug` 能力声明，Java 为 attach-first）。
      // 返回 true 吞掉，不冒泡给列级 toggle。
      if (capabilitiesFor(targetLang(hit.payload)).directRun) {
        onRun(hit.payload);
      } else {
        // 原型锚定：浮层紧贴图标（rect.right + 4 / rect.top），不用鼠标裸坐标。
        onMenuRequest(
          hit.payload,
          Math.round(hit.anchorRect.right + 4),
          Math.round(hit.anchorRect.top),
        );
      }
      return true;
    },
  };
}
