import { describe, expect, it } from 'vitest';

import { getProjectBrowserLabel } from '../useBrowserConstants';

describe('getProjectBrowserLabel', () => {
  it('derives the per-project webview label', () => {
    expect(getProjectBrowserLabel('p1')).toBe('neeko-browser-p1');
    expect(getProjectBrowserLabel('project-42')).toBe('neeko-browser-project-42');
  });

  it('matches the backend label convention (neeko-browser-{projectId})', () => {
    expect(getProjectBrowserLabel('any')).toMatch(/^neeko-browser-/);
  });
});
