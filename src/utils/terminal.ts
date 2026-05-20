import type { ITheme } from "@xterm/xterm";

const IS_LINUX = navigator.platform.toLowerCase().startsWith("linux");
const IS_MAC = navigator.platform.toLowerCase().startsWith("mac");

export const DEFAULT_FONT_FAMILY = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
  : "'SF Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

export function buildFontFamily(fontFamily: string): string {
  const base = fontFamily
    ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
    : DEFAULT_FONT_FAMILY;
  return `${base}, 'SymbolsNerdFontMono-Regular', 'NerdFontSymbols'`;
}

/** macOS Retina 优化的终端渲染参数 */
export const TERMINAL_LETTER_SPACING = IS_MAC ? 0.5 : 0;
export const TERMINAL_LINE_HEIGHT = IS_MAC ? 1.35 : 1.2;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const DARK_ANSI_COLORS: Partial<ITheme> = {
  black: "#0b0b0c",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#8b5cf6",
  cyan: "#06b6d4",
  white: "#f5f5f6",
  brightBlack: "#5c5c60",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#a78bfa",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

const LIGHT_ANSI_COLORS: Partial<ITheme> = {
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#4f5258",
  brightBlack: "#696c77",
  brightRed: "#e06c75",
  brightGreen: "#50a14f",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#000000",
};

export function buildTerminalTheme(): ITheme {
  const theme =
    document.documentElement.getAttribute("data-theme") || "dark";
  const isLight = theme === "light" || theme === "claude";
  const bg = cssVar("--bg-surface") || (isLight ? "#ffffff" : "#1a1a1d");

  // Sync terminal background to a dedicated CSS variable so all terminal
  // container layers (wrapper, xterm, scrollable-element, screen) stay in
  // lock-step with the actual terminal theme background.
  document.documentElement.style.setProperty("--terminal-bg", bg);

  return {
    background: bg,
    foreground: cssVar("--text-primary") || (isLight ? "#1e1e1e" : "#ededed"),
    cursor: cssVar("--accent-blue") || "#ffffff",
    selectionBackground: cssVar("--terminal-selection") || "#333333",
    selectionForeground: cssVar("--text-primary") || (isLight ? "#1e1e1e" : "#ededed"),
    ...(isLight ? LIGHT_ANSI_COLORS : DARK_ANSI_COLORS),
  };
}
