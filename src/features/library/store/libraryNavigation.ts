import { useSkillStore } from '@/features/skill/store';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import type { SkillView } from '@/shared/types';
import type { ResourceKind } from '@/shared/types/library';

import { useLibraryStore } from './libraryStore';

export interface OpenLibraryOptions {
  /** Resource tab to show. Defaults to 'skill'. */
  kind?: ResourceKind;
  /** Skill sub-view to select (only applies when kind is 'skill'). */
  skillView?: SkillView;
  /** Open the prompt insert dialog (only applies when kind is 'prompt'). */
  insert?: boolean;
}

/**
 * Framework-owned Library navigation (single source).
 *
 * Lives in `store/` (not `utils/`) on purpose: the skill feature consumes it,
 * and only the `store/` + `types/` + facade paths are importable cross-feature.
 * Importing it from the library facade would close a skill→library→skill module
 * cycle (LibraryDetail renders SkillContent); importing it from `utils/` trips
 * the import firewall. State is set before the tab opens, so the panel mounts
 * with the right selection — no deferred timers needed.
 */
export function openLibraryAt(opts: OpenLibraryOptions = {}): void {
  const { kind = 'skill', skillView, insert = false } = opts;
  if (kind === 'skill' && skillView) {
    const skill = useSkillStore.getState();
    skill.setActiveSkillView(skillView);
    skill.setActiveTagGroupIds([]);
    skill.setActiveAgentId(null);
  }
  useLibraryStore.getState().setActiveKind(kind);
  if (useAppViewStore.getState().appView !== 'library') {
    useDockStore.getState().togglePanel('library');
  }
  if (insert && kind === 'prompt') {
    useLibraryStore.getState().openInsert();
  }
}
