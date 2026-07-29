import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DockZoneState } from '@/shared/store/dockStore';

import { ensureSkillsPanelOpen } from '../ensureSkillsPanelOpen';

describe('ensureSkillsPanelOpen', () => {
  const togglePanel = vi.fn();
  const activatePanel = vi.fn();

  beforeEach(() => {
    togglePanel.mockReset();
    activatePanel.mockReset();
  });

  it('toggles when skills is not in any zone', () => {
    ensureSkillsPanelOpen({
      zones: {
        left: { id: 'left', panels: ['projects'], activePanelId: 'projects', expanded: true },
      },
      togglePanel,
      activatePanel,
    });
    expect(togglePanel).toHaveBeenCalledWith('skills');
    expect(activatePanel).not.toHaveBeenCalled();
  });

  it('no-ops when skills is already active and expanded', () => {
    const zones: Record<string, DockZoneState> = {
      left: {
        id: 'left',
        panels: ['skills', 'projects'],
        activePanelId: 'skills',
        expanded: true,
      },
    };
    ensureSkillsPanelOpen({ zones, togglePanel, activatePanel });
    expect(togglePanel).not.toHaveBeenCalled();
    expect(activatePanel).not.toHaveBeenCalled();
  });

  it('activates skills when present but not active', () => {
    const zones: Record<string, DockZoneState> = {
      left: {
        id: 'left',
        panels: ['skills', 'projects'],
        activePanelId: 'projects',
        expanded: true,
      },
    };
    ensureSkillsPanelOpen({ zones, togglePanel, activatePanel });
    expect(activatePanel).toHaveBeenCalledWith('left', 'skills');
    expect(togglePanel).not.toHaveBeenCalled();
  });

  it('activates skills when present but collapsed', () => {
    const zones: Record<string, DockZoneState> = {
      left: {
        id: 'left',
        panels: ['skills'],
        activePanelId: 'skills',
        expanded: false,
      },
    };
    ensureSkillsPanelOpen({ zones, togglePanel, activatePanel });
    expect(activatePanel).toHaveBeenCalledWith('left', 'skills');
  });
});
