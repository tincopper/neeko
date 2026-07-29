import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openProjectSkillsPanel } from '../openProjectSkillsPanel';

describe('openProjectSkillsPanel', () => {
  const ensureSkillsPanelOpen = vi.fn();
  const setActiveSkillView = vi.fn();
  const setActiveTagGroupIds = vi.fn();
  const setActiveAgentId = vi.fn();

  beforeEach(() => {
    ensureSkillsPanelOpen.mockReset();
    setActiveSkillView.mockReset();
    setActiveTagGroupIds.mockReset();
    setActiveAgentId.mockReset();
  });

  it('ensures skills dock is open and switches to project view', () => {
    openProjectSkillsPanel({
      ensureSkillsPanelOpen,
      setActiveSkillView,
      setActiveTagGroupIds,
      setActiveAgentId,
    });

    expect(ensureSkillsPanelOpen).toHaveBeenCalledTimes(1);
    expect(setActiveSkillView).toHaveBeenCalledWith('project');
    expect(setActiveTagGroupIds).toHaveBeenCalledWith([]);
    expect(setActiveAgentId).toHaveBeenCalledWith(null);
  });
});
