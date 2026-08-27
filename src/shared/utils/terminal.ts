import type { Terminal, ITheme } from '@xterm/xterm';

import { isDarkTheme } from './theme';

/** xterm scrollback 行数预算：控制 WebContent 常驻 DOM/内存上限（原 10000）。 */
export const TERMINAL_SCROLLBACK = 5000;

/**
 * 按需加载 Canvas 渲染器（TUI 内存风暴根治）。
 *
 * xterm 6.0 起默认渲染器改为 DOM renderer（每格一个 span，`xterm-fg-/xterm-bg-`
 * 类着色）；codebuddy 等 TUI 高频全屏重绘时每帧创建/更新数万个 span 节点，
 * WebCore 层对象堆积 → WebContent RSS 几秒暴涨数 GB（JS 堆与 DOM 计数均不涨）。
 * Canvas renderer 把绘制移到单个 canvas，DOM 节点固定，重绘只更新像素。
 *
 * 放在 shared/utils：终端与 task console 两个域共用，且动态 import 不进静态
 * 依赖图（失败时静默回退默认 DOM renderer，罕见环境）。
 */
export async function tryLoadCanvas(term: Terminal): Promise<void> {
  try {
    const { CanvasAddon } = await import('@xterm/addon-canvas');
    term.loadAddon(new CanvasAddon());
  } catch {
    /* Canvas 不可用时回退 xterm 默认 DOM renderer（罕见环境） */
  }
}

const IS_LINUX = navigator.platform.toLowerCase().startsWith('linux');

export const DEFAULT_FONT_FAMILY = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
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
  // Soft default glyph color (ANSI “white”) — less harsh than pure UI primary white.
  const softFg =
    (isDark ? DARK_ANSI_COLORS.white : LIGHT_ANSI_COLORS.white) ||
    cssVar('--text-secondary') ||
    (isDark ? '#abb2bf' : '#4f5258');
  const dimFg =
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
