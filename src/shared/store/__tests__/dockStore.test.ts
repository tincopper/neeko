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
        panels: ['projects'],
        activePanelId: 'projects',
        expanded: true,
      },
      right: { id: 'right', panels: ['files'], activePanelId: 'files', expanded: false },
    },
    barItems: [],
    rightPanelSizes: {},
    leftPanelSize: 18,
    leftZoneExpandedBeforeTabView: null,
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
    expect(state.leftZoneExpandedBeforeTabView).toBe(true);
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
    expect(useDockStore.getState().leftZoneExpandedBeforeTabView).toBe(false);

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
    expect(state.leftZoneExpandedBeforeTabView).toBeNull();
  });
});

/**
 * Tasks 从右栏窄条搬到中心全宽视图（用户要求：左栏菜单入口 + 一整块大看板）。
 *
 * 这四条钉的是**同一个机制的四个面**，缺一条都会让另一条的退化变得静默：
 *
 * | 用例 | 掉了之后的症状 |
 * | --- | --- |
 * | 点 Tasks → appView 'tasks' + 左栏收起 | 点了没反应（`isAppView` 不认 或 `openAs` 丢了）|
 * | 再点一次 → normal + 左栏恢复 | 进了出不来，左栏永远收着 |
 * | Tasks 中点右栏面板 → normal | 右栏面板叠在看板上，根本看不见 |
 * | Library 中点 Tasks → 直接切过去 | 两个中心视图互搏，左栏收起态被“恢复”成展开 |
 */
describe('dockStore togglePanel — tasks 中心视图', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('点左栏 Tasks → appView 为 tasks、**左栏保持展开**（只占中间区），且面板不进任何 zone', () => {
    useDockStore.getState().togglePanel('tasks');

    expect(useAppViewStore.getState().appView).toBe('tasks');
    const state = useDockStore.getState();
    // Tasks 只需要中间区：左栏 Projects 是「切项目」的入口，收起它等于把上下文藏起来
    // （`DOCK_PANEL_META.tasks.collapseLeftZone === false`）。
    expect(state.zones.left?.expanded).toBe(true);
    // 它仍然不是 dock 面板（否则会同时出现在左栏和中心区）
    expect(state.zones.left?.panels).not.toContain('tasks');
    expect(state.zones.right?.panels).not.toContain('tasks');
  });

  it('再点一次 → 回 normal 且左栏恢复原展开态', () => {
    useDockStore.getState().togglePanel('tasks');
    useDockStore.getState().togglePanel('tasks');

    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.left?.expanded).toBe(true);
  });

  it('Tasks 打开后点右侧 dock 面板 → 退出中心视图，左栏保持展开', () => {
    useDockStore.getState().togglePanel('tasks');
    expect(useAppViewStore.getState().appView).toBe('tasks');

    useDockStore.getState().togglePanel('files');

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.right?.activePanelId).toBe('files');
    expect(state.zones.right?.expanded).toBe(true);
    expect(state.zones.left?.expanded).toBe(true);
  });

  it('Library 中直接点 Tasks → Tasks 要把左栏放回来（两个视图的左栏策略不同）', () => {
    useDockStore.getState().togglePanel('library');
    expect(useDockStore.getState().zones.left?.expanded).toBe(false);

    useDockStore.getState().togglePanel('tasks');

    expect(useAppViewStore.getState().appView).toBe('tasks');
    // Tasks 不收左栏 ⇒ 从 Library 切过来时必须展开它（否则 Projects 永远回不来）
    expect(useDockStore.getState().zones.left?.expanded).toBe(true);
    // 仍记着“打开 tab 之前”的那个展开态，供退出时恢复
    expect(useDockStore.getState().leftZoneExpandedBeforeTabView).toBe(true);
  });
});

describe('dockStore — dock panels no longer drive appView (skills merged into Library)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('toggling a dock panel leaves appView untouched', () => {
    useDockStore.getState().togglePanel('projects');
    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.left?.activePanelId).toBe('projects');
  });

  it('activatePanel on a dock panel does not set a center view', () => {
    useDockStore.getState().activatePanel('left', 'projects');
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('closePanel on a dock panel leaves appView untouched', () => {
    useDockStore.getState().togglePanel('projects');
    useDockStore.getState().closePanel('projects');
    expect(useAppViewStore.getState().appView).toBe('normal');
  });
});

describe('dockStore togglePanel — toggle/activate 框架契约', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();
  });

  it('normal 下点已展开的面板 → 收起（toggle-off 仅当前可见时成立）', () => {
    useDockStore.getState().togglePanel('projects');
    expect(useDockStore.getState().zones.left?.expanded).toBe(false);
  });

  it('Library 中点 Projects → 退出并展开（不反转为收起）', () => {
    useDockStore.getState().togglePanel('library');
    expect(useAppViewStore.getState().appView).toBe('library');

    useDockStore.getState().togglePanel('projects');

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left?.activePanelId).toBe('projects');
    expect(state.zones.left?.expanded).toBe(true);
  });

  it('Library 中点右栏已展开面板 → 保持展开（不 toggle 关掉）', () => {
    useDockStore.setState((state) => ({
      zones: {
        ...state.zones,
        right: state.zones.right ? { ...state.zones.right, expanded: true } : state.zones.right,
      },
    }));
    useDockStore.getState().togglePanel('library');

    useDockStore.getState().togglePanel('files');

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.right?.activePanelId).toBe('files');
    expect(state.zones.right?.expanded).toBe(true);
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
    expect(isAppView('tasks')).toBe(true);
    expect(isAppView('settings')).toBe(true);
  });

  it('rejects arbitrary strings', () => {
    expect(isAppView('mysteryTab')).toBe(false);
    expect(isAppView('')).toBe(false);
    expect(isAppView('projects')).toBe(false);
    expect(isAppView('skills')).toBe(false); // 独立 skills 中心视图已并入 Library
  });
});
