import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSkillStore, initialSkillState } from '@/features/skill/store';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';

import { openLibraryAt } from '../libraryNavigation';
import { useLibraryStore } from '../libraryStore';

function resetStores() {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
  useSkillStore.setState(initialSkillState);
  useLibraryStore.setState({
    activeKind: 'prompt',
    insertOpen: false,
  });
  useDockStore.setState({
    zones: {
      left: { id: 'left', panels: ['projects'], activePanelId: 'projects', expanded: true },
      right: { id: 'right', panels: ['files'], activePanelId: 'files', expanded: false },
    },
  });
}

describe('openLibraryAt', () => {
  beforeEach(() => {
    resetStores();
    vi.restoreAllMocks();
  });

  it('opens the skill project view with a clean selection', () => {
    openLibraryAt({ kind: 'skill', skillView: 'project' });

    expect(useLibraryStore.getState().activeKind).toBe('skill');
    const skill = useSkillStore.getState();
    expect(skill.activeSkillView).toBe('project');
    expect(skill.activeTagGroupIds).toEqual([]);
    expect(skill.activeAgentId).toBeNull();
    expect(useAppViewStore.getState().appView).toBe('library');
  });

  it('opens the prompt tab with the insert dialog', () => {
    openLibraryAt({ kind: 'prompt', insert: true });

    expect(useLibraryStore.getState().activeKind).toBe('prompt');
    expect(useLibraryStore.getState().insertOpen).toBe(true);
    expect(useAppViewStore.getState().appView).toBe('library');
  });

  it('does not toggle the tab when already open', () => {
    useAppViewStore.setState({ appView: 'library' });
    const toggleSpy = vi.spyOn(useDockStore.getState(), 'togglePanel');

    openLibraryAt({ kind: 'skill' });

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(useAppViewStore.getState().appView).toBe('library');
  });
});
