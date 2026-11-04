import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSkillStore, initialSkillState } from '@/features/skill/store';
import { appViewKey } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';

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
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
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

  /**
   * `openLibraryAt` 只做导航：prompt 表单/选择器由 `PromptDialogHost` 常驻渲染，
   * 触发点直接调 store 的 open 动作，不该顺手把中心视图换成 Library。
   */
  it('opens the prompt tab without opening any dialog', () => {
    openLibraryAt({ kind: 'prompt' });

    expect(useLibraryStore.getState().activeKind).toBe('prompt');
    expect(useLibraryStore.getState().insertOpen).toBe(false);
    expect(useLibraryStore.getState().editorOpen).toBe(false);
    expect(useAppViewStore.getState().appView).toBe('library');
  });

  it('does not toggle the tab when already open', () => {
    useAppViewStore.setState({ appView: 'library' });
    const toggleSpy = vi.spyOn(useDockStore.getState(), 'toggleView');

    openLibraryAt({ kind: 'skill' });

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(useAppViewStore.getState().appView).toBe('library');
  });

  it('opening the library entry collapses the left slot (与左栏互斥)', () => {
    openLibraryAt({ kind: 'skill' });

    expect(useDockStore.getState().placements[appViewKey('library')].slot).toBe('left');
    expect(useDockStore.getState().zones.left.expanded).toBe(false);
  });
});
