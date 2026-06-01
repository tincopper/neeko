import type { ProjectTabs } from '@/shared/types/tab';

/** Theme color map passed to the browser_start_picker Rust command. */
export interface PickerThemeColors {
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textMuted: string;
  borderColor: string;
  accentBlue: string;
}

/**
 * Read the current application theme CSS variables from the root element.
 * Returns a color map that the PICKER_SCRIPT uses for styling.
 *
 * Falls back to dark-theme defaults when a variable is missing or empty
 * (e.g. in test environments where getComputedStyle returns blanks).
 */
export function getThemeColors(): PickerThemeColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    bgSecondary: v('--bg-secondary', '#272A30'),
    bgTertiary: v('--bg-tertiary', '#333337'),
    textPrimary: v('--text-primary', '#ffffff'),
    textMuted: v('--text-muted', '#999999'),
    borderColor: v('--border-color', '#3b3b40'),
    accentBlue: v('--accent-blue', '#2997ff'),
  };
}

/**
 * Check whether the given active tab is an Agent CLI terminal tab.
 * Pure function — no store access, fully testable.
 */
export function isAgentCliTab(
  projectTabs: ProjectTabs | undefined,
  activeTabId: string | null,
): boolean {
  if (!projectTabs || !activeTabId) return false;
  const tab = projectTabs.tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.data.kind !== 'terminal') return false;
  return tab.data.agentId !== null;
}

/**
 * Format the message sent to the Agent CLI terminal when the user
 * picks a browser element and enters a modification prompt.
 *
 * Returns the full text including a trailing `\r` so the terminal
 * executes it immediately.
 */
export function formatPickerMessage(
  prompt: string,
  html: string,
  browserUrl: string,
): string {
  return [
    'Please modify the following page element:',
    '',
    `@${browserUrl}`,
    '',
    `Requirement: ${prompt}`,
    '',
    'Element HTML:',
    '```html',
    html,
    '```',
  ].join('\n');
}
