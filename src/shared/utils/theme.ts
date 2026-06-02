/**
 * Known light theme identifiers.
 * Every theme not listed here — including all built-in dark themes
 * (dark, classic-dark, one-dark-pro) and all custom themes — is
 * treated as dark. This is the single source of truth for
 * dark vs light determination across the frontend.
 */
const LIGHT_THEMES: Record<string, true> = {
  light: true,
  claude: true,
};

/** Returns true when the theme should render in dark mode. */
export function isDarkTheme(theme: string): boolean {
  return !LIGHT_THEMES[theme];
}
