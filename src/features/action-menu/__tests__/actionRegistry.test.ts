import { describe, expect, it } from 'vitest';

import { getActionMenuItems } from '../actionRegistry';
import type { ActionContext } from '../types/actionMenu';

const baseCtx: ActionContext = {
  projectId: 'proj-1',
  tabKey: 'proj-1',
  agents: [],
  recentFiles: [],
  closeMenu: () => {},
};

describe('getActionMenuItems — new-browser entry', () => {
  it('includes the new-browser action in the browser group', () => {
    const items = getActionMenuItems(baseCtx);

    const browser = items.find((i) => i.id === 'new-browser');
    expect(browser).toBeDefined();
    expect(browser?.group).toBe('browser');
    expect(browser?.label).toBe('New Browser');
    expect(browser?.keywords).toContain('browser');
  });

  it('new-browser is always visible (no project/agent gating)', () => {
    const items = getActionMenuItems({ ...baseCtx, projectId: null, agents: [] });

    expect(items.some((i) => i.id === 'new-browser')).toBe(true);
  });

  it('new-browser matches the browser keyword filter', () => {
    const items = getActionMenuItems(baseCtx);

    const browser = items.find((i) => i.id === 'new-browser')!;
    expect(browser.keywords.some((k) => k.includes('browser') || k.includes('web'))).toBe(true);
  });
});
