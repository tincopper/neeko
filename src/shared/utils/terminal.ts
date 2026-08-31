import type { Terminal, ITheme } from '@xterm/xterm';

import { reportFrontendError } from './errorReporting';
import { isDarkTheme } from './theme';

/** xterm scrollback 行数预算：控制 WebContent 常驻 DOM/内存上限（原 10000）。 */
export const TERMINAL_SCROLLBACK = 5000;

/**
 * 终端渲染器计划（确定性渲染器选型）。
 *
 * 背景与不变式（renderer-plan 设计，根治 _linkifier2 竞态与意外降级）：
 * 1. 能力探测（detectWebgl）在启动期同步完成并缓存 —— 「支不支持」是确定事实，
 *    不在终端生命周期内反复判断；
 * 2. 模块预热（preloadRendererAddons，main.tsx 启动时调用）把唯一的真实异步
 *    import 挪到「不存在任何终端」的时机；运行期 await import 命中模块缓存 →
 *    续体在微任务阶段原子执行，dispose（宏任务）无法插入 —— 竞态窗口结构性闭合；
 * 3. 降级只允许发生在真正的能力边界上（loadAddon 同步失败），且必须打点
 *    （reportFrontendError）—— 意外的静默降级 = 功能不健全（DOM renderer 正是
 *    TUI 内存风暴的根源：每格一个 span，高频重绘下 WebContent RSS 暴涨）。
 */
export type RendererPlan = 'webgl' | 'canvas';

export function isTerminalDisposed(term: Terminal): boolean {
  const core = (term as unknown as { _core?: { _store?: { isDisposed?: boolean } } })?._core;
  return !!core?._store?.isDisposed;
}

export function safeDisposeTerminal(term: Terminal): void {
  try {
    term.dispose();
  } catch {
    // xterm dispose may throw when Canvas/WebGL addon restores DomRenderer with
    // already-disposed linkifier (this._linkifier2 undefined). Swallow — terminal
    // is already detached; failing to restore fallback renderer is harmless.
  }
}

/** WebGL 探测结果缓存：探测有成本且会占用上下文配额，进程生命周期内只做一次。 */
let webglSupport: boolean | null = null;

/**
 * 同步探测 WebGL2 支持。探测用的上下文会占用浏览器 WebGL 配额（通常仅 8~16 个），
 * 必须通过 WEBGL_lose_context 显式释放。结果进程级缓存。
 */
export function detectWebgl(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) {
      webglSupport = false;
    } else {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      webglSupport = true;
    }
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/**
 * 确定性渲染器决策：GPU 开关关闭 → canvas；开启且探测通过 → webgl。
 * 纯同步、无 await —— 与终端生命周期完全解耦。
 */
export function resolveRendererPlan(gpuEnabled: boolean): RendererPlan {
  return gpuEnabled && detectWebgl() ? 'webgl' : 'canvas';
}

/**
 * 启动期预热两个 renderer addon 模块（main.tsx 调用，无条件双预热：
 * 本地 tauri:// 协议加载代价可忽略，换取运行期 import 全部命中缓存）。
 * 预热完成后，applyRenderer 内的 await import 为微任务原子操作，
 * term.dispose()（宏任务）无法插入 —— 竞态窗口结构性闭合。
 */
export function preloadRendererAddons(): void {
  void import('@xterm/addon-canvas');
  void import('@xterm/addon-webgl');
}

/** linkifier 存在性：CanvasAddon/WebglAddon.activate 会解引用 core.linkifier!，
 * dispose 竞态下它为 undefined，装载渲染层将抛
 * `undefined is not an object (this._linkifier2.onShowLinkUnderline)`。 */
function hasLinkifier(term: Terminal): boolean {
  return !!(term as unknown as { _core?: { linkifier?: unknown } })._core?.linkifier;
}

/**
 * 按确定性计划装载渲染器。调用时机为终端创建期；配合启动期预热，
 * 此处的 await import 恒为微任务原子。降级（loadAddon 抛错）打点上报。
 */
export async function applyRenderer(term: Terminal, gpuEnabled: boolean): Promise<void> {
  const plan = resolveRendererPlan(gpuEnabled);
  try {
    if (plan === 'webgl') {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      if (isTerminalDisposed(term) || !hasLinkifier(term)) return;
      term.loadAddon(new WebglAddon());
      return;
    }
    const { CanvasAddon } = await import('@xterm/addon-canvas');
    if (isTerminalDisposed(term) || !hasLinkifier(term)) return;
    term.loadAddon(new CanvasAddon());
  } catch (err) {
    // 确定性降级到 DOM renderer：只应发生在真实能力边界（模块加载失败 /
    // GPU 上下文创建失败）。打点可观测 —— 静默降级是功能缺陷信号。
    reportFrontendError('terminal.renderer', err instanceof Error ? err : new Error(String(err)));
  }
}

const IS_LINUX = navigator.platform.toLowerCase().startsWith('linux');

export const DEFAULT_FONT_FAMILY = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
export function buildFontFamily(fontFamily: string): string {
  const base = fontFamily ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY;
  // NerdFontSymbols 作为 PUA 码点最终 fallback（CSS @font-face 通过
  // unicode-range 仅对图标码点生效，不影响普通文字字体选择）
  return `${base}, 'NerdFontSymbols'`;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const DARK_ANSI_COLORS: Partial<ITheme> = {
  black: '#000000',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const LIGHT_ANSI_COLORS: Partial<ITheme> = {
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#4f5258',
  brightBlack: '#696c77',
  brightRed: '#e06c75',
  brightGreen: '#50a14f',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#000000',
};

export function buildTerminalTheme(): ITheme {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isDark = isDarkTheme(theme);
  const bg = cssVar('--bg-secondary') || (isDark ? '#000000' : '#ffffff');
  // Mono 前景：优先 --mono-fg 角色 token（与编辑器共用），回退 ANSI soft white
  const monoFg = cssVar('--mono-fg');
  const monoFgDim = cssVar('--mono-fg-dim');
  const softFg =
    monoFg ||
    (isDark ? DARK_ANSI_COLORS.white : LIGHT_ANSI_COLORS.white) ||
    cssVar('--text-secondary') ||
    (isDark ? '#abb2bf' : '#4f5258');
  const dimFg =
    monoFgDim ||
    (isDark ? DARK_ANSI_COLORS.brightBlack : LIGHT_ANSI_COLORS.brightBlack) ||
    cssVar('--text-muted') ||
    (isDark ? '#5c6370' : '#696c77');

  // Sync terminal colors so Debug Console / other panes can match xterm exactly.
  document.documentElement.style.setProperty('--terminal-bg', bg);
  document.documentElement.style.setProperty('--terminal-fg', softFg);
  document.documentElement.style.setProperty('--terminal-fg-dim', dimFg);

  return {
    background: bg,
    // Use soft ANSI white so Task Console default text is grayish, not pure white.
    foreground: softFg,
    cursor: cssVar('--accent-blue') || '#ffffff',
    selectionBackground: cssVar('--terminal-selection') || '#333333',
    selectionForeground: softFg,
    // Theme xterm's overlay scrollbar with the same tokens as the app chrome
    // (base.css global scrollbars) so the Console panel matches other panels.
    scrollbarSliderBackground: cssVar('--bg-hover') || (isDark ? '#3e4451' : '#c9cdd4'),
    scrollbarSliderHoverBackground: cssVar('--text-muted') || (isDark ? '#5c6370' : '#9a9ea5'),
    scrollbarSliderActiveBackground: cssVar('--text-muted') || (isDark ? '#5c6370' : '#9a9ea5'),
    ...(isDark ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS),
  };
}
