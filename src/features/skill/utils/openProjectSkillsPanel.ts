import type { SkillView } from '@/shared/types';

export interface OpenProjectSkillsPanelDeps {
  /** Open skills dock without closing if already expanded on skills. */
  ensureSkillsPanelOpen: () => void;
  setActiveSkillView: (view: SkillView) => void;
  setActiveTagGroupIds: (ids: string[]) => void;
  setActiveAgentId: (id: string | null) => void;
}

/**
 * Navigate to Skills → Project view so bound tag groups are visible.
 */
export function openProjectSkillsPanel(deps: OpenProjectSkillsPanelDeps): void {
  deps.ensureSkillsPanelOpen();
  deps.setActiveSkillView('project');
  deps.setActiveTagGroupIds([]);
  deps.setActiveAgentId(null);
}
