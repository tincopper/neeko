/**
 * 单测 / main 运行 gutter 贡献的**装配层与公开 API**。
 *
 * 行号旁 Run/Debug 图标（JetBrains/RustRover 原型风格）：测试用例行与 **main 入口行共用同一套
 * 显示/点击机制**（同一 play 图标、同一 field、同一主题、同一浮层路由）。每个可运行行在统一
 * gutter 列（`cm-breakpoint-gutter`，断点列复用）显示绿色 play 图标，点击按语言能力分流：
 * - `directRun` 语言（TS/JS）：直接 `onRun(target)`（无 Debug 能力，单项菜单无意义）；
 * - 其余（Rust/Go/Java，测试与 main 皆然）：`onMenuRequest(target, x, y)` → React 层在图标 rect
 *   旁弹 Run/Debug 浮层（Java Debug 为 attach-first，Go 走 dlv mode:exec）。
 *
 * 点击路由由统一 gutter 列级委托处理（registry mousedown 经 `[data-gutter-contributions]`
 * 显式命中 → onClick）；图标本体为纯视觉片段，不自吞事件，保证路由唯一。
 *
 * **本目录的职责划分**（同目录拆分，依赖单向，避免单文件承载多个变更原因）：
 * | 文件 | 职责 |
 * |---|---|
 * | `runTarget.ts` | 输入契约与目标身份（`RunTarget` / facet / 行号与语言派生） |
 * | `runLspOverlay.ts` | tier ① LSP 覆盖的状态定义（被读方与写方共用，故为叶子模块） |
 * | `runMarkers.ts` | 文档 → markers 的同步重建 + 图标外观（性能红线所在） |
 * | `runContribution.ts`（本文件） | 异步 tier ① 拉取、扩展装配、贡献与公开查询 API |
 *
 * 本模块不注册独立 gutter 列：图标列由统一 gutter 提供。
 */
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

import {
  capabilitiesFor,
  isRunnableFile,
  overlayProviderFor,
  targetLang,
  type LineTarget,
  type RunTarget,
} from '@/features/runner';

import type { GutterContribution, GutterHit, GutterLineContext } from './contribution';
import { runCodelensConfig, type RunCodelensConfig } from './runCodelensConfig';
import {
  lspRunnablesField,
  refreshRunCodelensEffect,
  setLspRunnablesEffect,
} from './runLspOverlay';
import { buildRunElement, runCodelensField, runCodelensCoreTheme } from './runMarkers';

/**
 * 异步拉取 LSP runnable 并注入 field（tier ①）。**只在 rust 文件 + RA 就绪时**发起；
 * 任何失败/未命中静默跳过（快路径结果原样保留）。派发前校验目标集合未变，避免陈旧覆盖。
 */
async function loadLspRunnables(view: EditorView): Promise<void> {
  const config = view.state.facet(runCodelensConfig);
  const { projectId, absFilePath, projectPath, fileName } = config;
  if (!projectId || !absFilePath || !projectPath) return;
  // tier ① 由**语言模块**提供（`overlayProviderFor`）：本层不认识任何语言，也就没有
  // `.rs` 判断与「RA 是否就绪」这类语言专属门控（无 provider 的语言直接跳过）。
  const provider = overlayProviderFor(fileName);
  if (!provider) return;

  const targets: LineTarget[] = [];
  for (const line of runLinesOf(view.state)) {
    const target = runAtLine(view.state, line);
    if (target) targets.push({ line, kind: target.kind });
  }
  if (targets.length === 0) return;

  const signature = targets.map((t) => `${t.line}:${t.kind}`).join(',');
  const overlay = await provider.load({ projectId, projectPath, absFilePath, targets });
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

/** 防抖重解析间隔（ms）—— 装配层关注点，不进公开面。 */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * 可运行检测核心扩展：仅装配 facet + field + 防抖重解析监听，
 * 不注册独立 gutter 列（图标列由统一 gutter `cm-breakpoint-gutter` 提供）。
 */
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
