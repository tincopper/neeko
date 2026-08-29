import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppView, useAppViewStore } from '../appViewStore';
import { useDockStore } from '../dockStore';

// Inject a misconfigured tab panel (openAs: 'tab' but NOT a valid AppView) to
// exercise the isAppView defensive guard in togglePanel.
vi.mock('../../dock/panelMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dock/panelMeta')>();
  return {
    ...actual,
    DOCK_PANEL_META: {
      ...actual.DOCK_PANEL_META,
      mysteryTab: { id: 'mysteryTab', defaultZone: 'left', defaultOrder: 99, openAs: 'tab' },
    },
  };
});

/** Reset both stores to a clean baseline for each test. */
function resetStores() {
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({
    zones: {
      left: {
        id: 'left',
        panels: ['projects', 'skills'],
        activePanelId: 'projects',
        expanded: true,
      },
      right: { id: 'right', panels: ['files'], activePanelId: 'files', expanded: false },
    },
    barItems: [],
    rightPanelSizes: {},
    leftPanelSize: 18,
    leftZoneExpandedBeforeLibrary: null,
  });
}

describe('dockStore togglePanel — tab (center) views', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('excludes tab-mode panels from dock zones at initialization', () => {
    const { zones } = useDockStore.getState();
    expect(zones.left?.panels).not.toContain('library');
  });

  it('opens library tab: switches appView, collapses left zone, remembers expansion', () => {
    useDockStore.getState().togglePanel('library');

    expect(useAppViewStore.getState().appView).toBe('library');
    const state = useDockStore.getState();
    expect(state.zones.left?.expanded).toBe(false);
    expect(state.leftZoneExpandedBeforeLibrary).toBe(true);
  });

  it('closing library tab restores the remembered left zone state', () => {
    useDockStore.getState().togglePanel('library');
    useDockStore.getState().togglePanel('library');

    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.left?.expanded).toBe(true);
  });

  it('restores left zone even when it was collapsed before opening library', () => {
    useDockStore.setState((state) => ({
      zones: {
        ...state.zones,
        left: state.zones.left ? { ...state.zones.left, expanded: false } : state.zones.left,
      },
    }));
    useDockStore.getState().togglePanel('library');
    expect(useDockStore.getState().leftZoneExpandedBeforeLibrary).toBe(false);

    useDockStore.getState().togglePanel('library');
    expect(useDockStore.getState().zones.left?.expanded).toBe(false);
  });

  it('opening a dock panel exits the library view and restores left zone', () => {
    useDockStore.getState().togglePanel('library');
    expect(useAppViewStore.getState().appView).toBe('library');

    useDockStore.getState().togglePanel('files');

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left?.expanded).toBe(true);
    expect(state.zones.right?.expanded).toBe(true); // files toggled open
  });

  it('ignores tab panels whose id is not a real AppView (defensive guard)', () => {
    useDockStore.getState().togglePanel('mysteryTab');

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left?.expanded).toBe(true);
    expect(state.leftZoneExpandedBeforeLibrary).toBeNull();
  });
});

describe('dockStore togglePanel — center-coupled dock panels (skills ↔ appView)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('activating skills dock panel switches appView to skills', () => {
    useDockStore.getState().togglePanel('skills');
    expect(useAppViewStore.getState().appView).toBe('skills');
    const state = useDockStore.getState();
    expect(state.zones.left?.activePanelId).toBe('skills');
    expect(state.zones.left?.expanded).toBe(true);
  });

  it('collapsing an already-active skills panel keeps skills view', () => {
    useDockStore.setState((state) => ({
      zones: {
        ...state.zones,
        left: state.zones.left
          ? { ...state.zones.left, activePanelId: 'skills' }
          : state.zones.left,
      },
    }));
    useAppViewStore.setState({ appView: 'skills' });

    useDockStore.getState().togglePanel('skills'); // active → collapse

    expect(useAppViewStore.getState().appView).toBe('skills');
    expect(useDockStore.getState().zones.left?.expanded).toBe(false);
  });

  it('opening another dock panel exits the skills view back to normal', () => {
    useDockStore.getState().togglePanel('skills');
    expect(useAppViewStore.getState().appView).toBe('skills');

    useDockStore.getState().togglePanel('files');

    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('activatePanel on skills syncs appView, on other panels exits skills', () => {
    useDockStore.getState().activatePanel('left', 'skills');
    expect(useAppViewStore.getState().appView).toBe('skills');

    useDockStore.getState().activatePanel('left', 'projects');
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('closePanel on skills exits the skills view', () => {
    useDockStore.getState().togglePanel('skills');
    expect(useAppViewStore.getState().appView).toBe('skills');

    useDockStore.getState().closePanel('skills');
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('library and skills views are independent: opening library from skills exits skills', () => {
    useDockStore.getState().togglePanel('skills');
    expect(useAppViewStore.getState().appView).toBe('skills');

    useDockStore.getState().togglePanel('library');

    expect(useAppViewStore.getState().appView).toBe('library');
  });
});

describe('dockStore persist merge — activePanelId 恢复', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('rehydrate 恢复仍属于注册表面板清单的持久化 activePanelId', async () => {
    localStorage.setItem(
      'neeko-dock-layout',
      JSON.stringify({
        state: {
          zones: {
            right: { id: 'right', panels: ['files'], activePanelId: 'gitControl', expanded: true },
          },
        },
        version: 5,
      }),
    );

    await useDockStore.persist.rehydrate();

    expect(useDockStore.getState().zones.right?.activePanelId).toBe('gitControl');
    expect(useDockStore.getState().zones.right?.expanded).toBe(true);
  });

  it('持久化的 activePanelId 已不在注册表面板清单内时回退 panels[0]（防悬挂引用）', async () => {
    localStorage.setItem(
      'neeko-dock-layout',
      JSON.stringify({
        state: {
          zones: {
            right: { id: 'right', panels: ['files'], activePanelId: 'ghostPanel', expanded: true },
          },
        },
        version: 5,
      }),
    );

    await useDockStore.persist.rehydrate();

    expect(useDockStore.getState().zones.right?.activePanelId).toBe('files');
  });

  it('无持久化数据时保持默认 activePanelId（panels[0]）', async () => {
    await useDockStore.persist.rehydrate();

    expect(useDockStore.getState().zones.right?.activePanelId).toBe('files');
  });
});

describe('appViewStore isAppView guard', () => {
  it('accepts real AppView values', () => {
    expect(isAppView('normal')).toBe(true);
    expect(isAppView('library')).toBe(true);
    expect(isAppView('settings')).toBe(true);
  });

  it('rejects arbitrary strings', () => {
    expect(isAppView('mysteryTab')).toBe(false);
    expect(isAppView('')).toBe(false);
    expect(isAppView('projects')).toBe(false);
  });
});
