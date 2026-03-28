const IS_LINUX = navigator.platform.toLowerCase().startsWith("linux");

export const DEFAULT_FONT_FAMILY = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

export function buildFontFamily(fontFamily: string): string {
  return fontFamily
    ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
    : DEFAULT_FONT_FAMILY;
}
