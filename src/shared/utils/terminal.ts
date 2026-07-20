import type { ITheme } from "@xterm/xterm";
import { isDarkTheme } from './theme';

const IS_LINUX = navigator.platform.toLowerCase().startsWith("linux");

export const DEFAULT_FONT_FAMILY = IS_LINUX
   ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
   : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

export function buildFontFamily(fontFamily: string): string {
   const base = fontFamily
      ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
      : DEFAULT_FONT_FAMILY;
   // NerdFontSymbols 作为 PUA 码点最终 fallback（CSS @font-face 通过
   // unicode-range 仅对图标码点生效，不影响普通文字字体选择）
   return `${base}, 'NerdFontSymbols'`;
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
   const isDark = isDarkTheme(theme);
   const bg = cssVar("--bg-secondary") || (isDark ? "#000000" : "#ffffff");
   // Soft default glyph color (ANSI “white”) — less harsh than pure UI primary white.
   const softFg =
      (isDark ? DARK_ANSI_COLORS.white : LIGHT_ANSI_COLORS.white) ||
      cssVar("--text-secondary") ||
      (isDark ? "#abb2bf" : "#4f5258");
   const dimFg =
      (isDark ? DARK_ANSI_COLORS.brightBlack : LIGHT_ANSI_COLORS.brightBlack) ||
      cssVar("--text-muted") ||
      (isDark ? "#5c6370" : "#696c77");

   // Sync terminal colors so Debug Console / other panes can match xterm exactly.
   document.documentElement.style.setProperty("--terminal-bg", bg);
   document.documentElement.style.setProperty("--terminal-fg", softFg);
   document.documentElement.style.setProperty("--terminal-fg-dim", dimFg);

   return {
      background: bg,
      // Use soft ANSI white so Task Console default text is grayish, not pure white.
      foreground: softFg,
      cursor: cssVar("--accent-blue") || "#ffffff",
      selectionBackground: cssVar("--terminal-selection") || "#333333",
      selectionForeground: softFg,
      ...(isDark ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS),
   };
}
