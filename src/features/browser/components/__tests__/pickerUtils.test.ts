import { describe, it, expect, beforeEach } from 'vitest';

import type { ProjectTabs, Tab } from '@/shared/types/tab';

import { isAgentCliTab, formatPickerMessage, getThemeColors } from '../pickerUtils';

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
    expect(colors.bgSecondary).toBe('#181A1C');
    expect(colors.textPrimary).toBe('#ffffff');
    expect(colors.accentBlue).toBe('#2997ff');
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
      'accentBlue',
      'bgSecondary',
      'bgTertiary',
      'borderColor',
      'textMuted',
      'textPrimary',
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
        data: {
          kind: 'file',
          filePath: '/a.ts',
          fileName: 'a.ts',
          content: { text: '' },
          isDirty: false,
        },
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
  it('produces correctly formatted message for a single element', () => {
    const result = formatPickerMessage(
      'Make this button red',
      [{ html: '<button class="btn">Submit</button>', selector: 'button.btn' }],
      'http://localhost:3000/dashboard',
    );

    expect(result).toContain('Please modify the following page element:');
    expect(result).toContain('@http://localhost:3000/dashboard');
    expect(result).toContain('Requirement: Make this button red');
    expect(result).toContain('Element HTML:');
    expect(result).toContain('```html');
    expect(result).toContain('<button class="btn">Submit</button>');
    expect(result).toContain('```');
    expect(result).not.toContain('page elements:');
    expect(result).not.toContain('Element 1');
  });

  it('numbers each element for multi-select', () => {
    const result = formatPickerMessage(
      'Make them bigger',
      [
        { html: '<button id="navCta">Go</button>', selector: 'button#navCta' },
        { html: '<div class="card">x</div>', selector: 'div.card' },
      ],
      'http://localhost:3000/dashboard',
    );

    expect(result).toContain('Please modify the following page elements:');
    expect(result).toContain('Element 1 (button#navCta):');
    expect(result).toContain('<button id="navCta">Go</button>');
    expect(result).toContain('Element 2 (div.card):');
    expect(result).toContain('<div class="card">x</div>');
    expect(result).not.toContain('page element:');
    expect(result).not.toContain('Element HTML:');
  });

  it('falls back to unknown selector when selector is empty', () => {
    const result = formatPickerMessage(
      'fix',
      [
        { html: '<span>a</span>', selector: '' },
        { html: '<span>b</span>', selector: 'span.b' },
      ],
      'http://example.com',
    );
    expect(result).toContain('Element 1 (unknown):');
    expect(result).toContain('Element 2 (span.b):');
  });

  it('handles empty elements list without crashing (guard rejects earlier)', () => {
    const result = formatPickerMessage('nope', [], 'http://example.com');
    expect(result).toContain('Please modify the following page element:');
    expect(result).not.toContain('```html');
  });

  it('does not include trailing \\r (caller is responsible)', () => {
    const result = formatPickerMessage(
      'test',
      [{ html: '<div/>', selector: 'div' }],
      'http://example.com',
    );
    expect(result.endsWith('\r')).toBe(false);
  });

  it('preserves multi-line HTML', () => {
    const html = '<div>\n  <span>hello</span>\n</div>';
    const result = formatPickerMessage('fix it', [{ html, selector: 'div' }], 'http://example.com');
    expect(result).toContain(html);
  });
});
