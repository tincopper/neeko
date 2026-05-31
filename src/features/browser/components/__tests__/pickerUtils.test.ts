import { describe, it, expect, beforeEach } from 'vitest';
import { isAgentCliTab, formatPickerMessage, getThemeColors } from '../pickerUtils';
import type { ProjectTabs, Tab } from '@/shared/types/tab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(overrides: Partial<Tab> & { data: Tab['data'] }): Tab {
  return {
    id: 'tab-1',
    projectId: 'proj-1',
    title: 'Terminal',
    order: 0,
    ...overrides,
  };
}

function makeProjectTabs(tabs: Tab[], activeTabId: string | null = 'tab-1'): ProjectTabs {
  return { tabs, activeTabId };
}

// ---------------------------------------------------------------------------
// getThemeColors
// ---------------------------------------------------------------------------

describe('getThemeColors', () => {
  beforeEach(() => {
    // Reset any custom properties set in previous tests
    document.documentElement.style.cssText = '';
  });

  it('returns fallback values when CSS variables are not set', () => {
    const colors = getThemeColors();
    expect(colors.bgSecondary).toBe('#252528');
    expect(colors.textPrimary).toBe('#ededed');
    expect(colors.accentBlue).toBe('#61afef');
  });

  it('reads CSS variables from :root when available', () => {
    document.documentElement.style.setProperty('--bg-secondary', '#ff0000');
    document.documentElement.style.setProperty('--text-primary', '#00ff00');
    const colors = getThemeColors();
    expect(colors.bgSecondary).toBe('#ff0000');
    expect(colors.textPrimary).toBe('#00ff00');
  });

  it('returns all expected keys', () => {
    const colors = getThemeColors();
    expect(Object.keys(colors).sort()).toEqual([
      'accentBlue', 'bgSecondary', 'bgTertiary', 'borderColor', 'textMuted', 'textPrimary',
    ]);
  });
});

// ---------------------------------------------------------------------------
// isAgentCliTab
// ---------------------------------------------------------------------------

describe('isAgentCliTab', () => {
  it('returns true when active tab is a terminal with agentId', () => {
    const tabs = makeProjectTabs([
      makeTab({ id: 'tab-1', data: { kind: 'terminal', agentId: 'claude', status: 'Running' } }),
    ]);
    expect(isAgentCliTab(tabs, 'tab-1')).toBe(true);
  });

  it('returns false when active tab is a terminal without agentId', () => {
    const tabs = makeProjectTabs([
      makeTab({ id: 'tab-1', data: { kind: 'terminal', agentId: null, status: 'Idle' } }),
    ]);
    expect(isAgentCliTab(tabs, 'tab-1')).toBe(false);
  });

  it('returns false when active tab is a file tab', () => {
    const tabs = makeProjectTabs([
      makeTab({
        id: 'tab-1',
        data: { kind: 'file', filePath: '/a.ts', fileName: 'a.ts', content: { text: '' }, isDirty: false },
      }),
    ]);
    expect(isAgentCliTab(tabs, 'tab-1')).toBe(false);
  });

  it('returns false when activeTabId is null', () => {
    const tabs = makeProjectTabs([
      makeTab({ id: 'tab-1', data: { kind: 'terminal', agentId: 'claude', status: 'Running' } }),
    ]);
    expect(isAgentCliTab(tabs, null)).toBe(false);
  });

  it('returns false when projectTabs is undefined', () => {
    expect(isAgentCliTab(undefined, 'tab-1')).toBe(false);
  });

  it('returns false when activeTabId does not match any tab', () => {
    const tabs = makeProjectTabs([
      makeTab({ id: 'tab-1', data: { kind: 'terminal', agentId: 'claude', status: 'Running' } }),
    ]);
    expect(isAgentCliTab(tabs, 'nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatPickerMessage
// ---------------------------------------------------------------------------

describe('formatPickerMessage', () => {
  it('produces correctly formatted message', () => {
    const result = formatPickerMessage(
      'Make this button red',
      '<button class="btn">Submit</button>',
      'http://localhost:3000/dashboard',
    );

    expect(result).toContain('Please modify the following page element:');
    expect(result).toContain('@http://localhost:3000/dashboard');
    expect(result).toContain('Requirement: Make this button red');
    expect(result).toContain('```html');
    expect(result).toContain('<button class="btn">Submit</button>');
    expect(result).toContain('```');
  });

  it('does not include trailing \\r (caller is responsible)', () => {
    const result = formatPickerMessage('test', '<div/>', 'http://example.com');
    expect(result.endsWith('\r')).toBe(false);
  });

  it('preserves multi-line HTML', () => {
    const html = '<div>\n  <span>hello</span>\n</div>';
    const result = formatPickerMessage('fix it', html, 'http://example.com');
    expect(result).toContain(html);
  });
});
