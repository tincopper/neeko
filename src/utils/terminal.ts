import type { ITheme } from "@xterm/xterm";

const IS_LINUX = navigator.platform.toLowerCase().startsWith("linux");

export const DEFAULT_FONT_FAMILY = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

export function buildFontFamily(fontFamily: string): string {
  return fontFamily
    ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
    : DEFAULT_FONT_FAMILY;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const DARK_ANSI_COLORS: Partial<ITheme> = {
  black: "#000000",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
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

  return {
    background: cssVar("--bg-primary") || (isLight ? "#ffffff" : "#000000"),
    foreground: cssVar("--text-primary") || (isLight ? "#1e1e1e" : "#ededed"),
    cursor: cssVar("--accent-blue") || "#ffffff",
    selectionBackground: cssVar("--terminal-selection") || "#333333",
    selectionForeground: cssVar("--text-primary") || (isLight ? "#1e1e1e" : "#ededed"),
    ...(isLight ? LIGHT_ANSI_COLORS : DARK_ANSI_COLORS),
  };
}
