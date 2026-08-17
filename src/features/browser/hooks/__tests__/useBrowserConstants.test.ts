import { describe, expect, it } from 'vitest';

import { getBrowserTabLabel, getProjectBrowserLabel } from '../useBrowserConstants';

describe('getProjectBrowserLabel', () => {
  it('derives the per-project webview label', () => {
    expect(getProjectBrowserLabel('p1')).toBe('neeko-browser-p1');
    expect(getProjectBrowserLabel('project-42')).toBe('neeko-browser-project-42');
  });

  it('matches the backend label convention (neeko-browser-{projectId})', () => {
    expect(getProjectBrowserLabel('any')).toMatch(/^neeko-browser-/);
  });
});

describe('getBrowserTabLabel', () => {
  it('derives a per-tab webview label distinct from the per-project label', () => {
    expect(getBrowserTabLabel('t1')).toBe('neeko-browser-tab-t1');
    expect(getBrowserTabLabel('tab_abc')).toBe('neeko-browser-tab-tab_abc');
  });

  it('is unique per tab id (two tabs never share a label)', () => {
    expect(getBrowserTabLabel('t1')).not.toBe(getBrowserTabLabel('t2'));
  });

  it('matches the backend label convention (neeko-browser-tab-{tabId})', () => {
    expect(getBrowserTabLabel('any')).toMatch(/^neeko-browser-tab-/);
  });
});
