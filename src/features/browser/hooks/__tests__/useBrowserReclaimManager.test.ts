import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectBrowserStore } from '@/shared/store/browserStore';
import type { BrowserPanelState } from '@/shared/store/browserStore';
import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import type { BrowserTabState } from '@/shared/store/browserTabsStore';
import { useProjectStore } from '@/shared/store/projectStore';

const browserCloseMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/browser/api/browserApi', () => ({
  browserClose: (...args: unknown[]) => browserCloseMock(...args),
}));

import { checkReclaims } from '../useBrowserReclaimManager';

const IDLE_MS = 31 * 60 * 1000; // 超过默认 30min 闲置阈值

function panelState(
  projectId: string,
  overrides: Partial<BrowserPanelState> = {},
): BrowserPanelState {
  return {
    label: `neeko-browser-${projectId}`,
    url: 'https://a.com',
    isCreated: true,
    isLoading: false,
    history: { entries: ['https://a.com'], index: 0 },
    title: 'A',
    favicon: '',
    lastActiveAt: 0,
    ...overrides,
  };
}

function tabState(tabId: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    label: `neeko-browser-tab-${tabId}`,
    url: 'https://a.com',
    isCreated: true,
    isLoading: false,
    history: { entries: ['https://a.com'], index: 0 },
    title: 'A',
    favicon: '',
    lastActiveAt: 0,
    isActive: false,
    ...overrides,
  };
}

describe('useBrowserReclaimManager — 统一覆盖 panel + tab', () => {
  beforeEach(() => {
    useProjectStore.setState({ activeProjectId: null, projects: [] });
    useProjectBrowserStore.setState({ states: {} });
    useBrowserTabsStore.setState({ states: {} });
    browserCloseMock.mockClear();
  });

  it('仅用 dock 面板（无 tab）时，闲置面板 webview 也被回收', () => {
    const now = Date.now();
    useProjectBrowserStore.setState({
      states: {
        p1: panelState('p1', { lastActiveAt: now - IDLE_MS }),
      },
    });

    checkReclaims();

    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-p1');
    expect(useProjectBrowserStore.getState().states['p1'].isCreated).toBe(false);
  });

  it('同时回收闲置的 panel 与 tab webview（统一策略）', () => {
    const now = Date.now();
    useProjectBrowserStore.setState({
      states: { p1: panelState('p1', { lastActiveAt: now - IDLE_MS }) },
    });
    useBrowserTabsStore.setState({
      states: { tab_b1: tabState('tab_b1', { lastActiveAt: now - IDLE_MS }) },
    });

    checkReclaims();

    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-p1');
    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-tab-tab_b1');
    expect(useProjectBrowserStore.getState().states['p1'].isCreated).toBe(false);
    expect(useBrowserTabsStore.getState().states['tab_b1'].isCreated).toBe(false);
  });

  it('当前活跃项目的面板 webview 永不回收', () => {
    const now = Date.now();
    useProjectStore.setState({ activeProjectId: 'p1' });
    useProjectBrowserStore.setState({
      states: { p1: panelState('p1', { lastActiveAt: now - IDLE_MS }) },
    });

    checkReclaims();

    expect(browserCloseMock).not.toHaveBeenCalled();
    expect(useProjectBrowserStore.getState().states['p1'].isCreated).toBe(true);
  });

  it('未创建（isCreated=false）的 webview 跳过', () => {
    const now = Date.now();
    useProjectBrowserStore.setState({
      states: { p1: panelState('p1', { isCreated: false, lastActiveAt: now - IDLE_MS }) },
    });

    checkReclaims();

    expect(browserCloseMock).not.toHaveBeenCalled();
  });
});
