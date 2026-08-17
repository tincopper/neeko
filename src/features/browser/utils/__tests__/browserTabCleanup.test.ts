import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { useEditorStore } from '@/shared/store/editorStore';

const browserCloseMock = vi.fn().mockResolvedValue(undefined);
const browserSetVisibleMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/browser/api/browserApi', () => ({
  browserClose: (...args: unknown[]) => browserCloseMock(...args),
  browserSetVisible: (...args: unknown[]) => browserSetVisibleMock(...args),
}));

import { ensureBrowserTabCleanupRegistered } from '../browserTabCleanup';

describe('browserTabCleanup — 关闭 browser tab 销毁 webview + 清除状态', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useBrowserTabsStore.setState({ states: {} });
    browserCloseMock.mockClear();
    browserSetVisibleMock.mockClear();
  });

  it('closeTab 关闭 browser tab 时先隐藏再关闭 webview 并移除 per-tab 状态', () => {
    ensureBrowserTabCleanupRegistered();

    useEditorStore.getState().addTab('p1', {
      id: 'tab_b1',
      projectId: 'p1',
      title: 'GitHub',
      order: 0,
      data: { kind: 'browser', url: 'https://github.com' },
    });
    useBrowserTabsStore.getState().setTabState('tab_b1', {
      url: 'https://github.com',
      title: 'GitHub',
      isCreated: true,
      isActive: true,
      lastActiveAt: Date.now(),
    });

    useEditorStore.getState().closeTab('p1', 'tab_b1');

    expect(browserSetVisibleMock).toHaveBeenCalledWith('neeko-browser-tab-tab_b1', false);
    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-tab-tab_b1');
    expect(useBrowserTabsStore.getState().states['tab_b1']).toBeUndefined();
  });

  it('clearProjectTabs 清空项目时对所有 browser tab 执行 browserClose', () => {
    ensureBrowserTabCleanupRegistered();

    useEditorStore.getState().addTab('p1', {
      id: 'tab_b1',
      projectId: 'p1',
      title: 'A',
      order: 0,
      data: { kind: 'browser', url: 'https://a.com' },
    });
    useEditorStore.getState().addTab('p1', {
      id: 'tab_b2',
      projectId: 'p1',
      title: 'B',
      order: 1,
      data: { kind: 'browser', url: 'https://b.com' },
    });
    useBrowserTabsStore.getState().setTabState('tab_b1', { url: 'https://a.com', isCreated: true });
    useBrowserTabsStore.getState().setTabState('tab_b2', { url: 'https://b.com', isCreated: true });

    useEditorStore.getState().clearProjectTabs('p1');

    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-tab-tab_b1');
    expect(browserCloseMock).toHaveBeenCalledWith('neeko-browser-tab-tab_b2');
    expect(useBrowserTabsStore.getState().states).toEqual({});
  });

  it('关闭非 browser 类型 tab 不触发 browserClose', () => {
    ensureBrowserTabCleanupRegistered();

    useEditorStore.getState().addTab('p1', {
      id: 'tab_t1',
      projectId: 'p1',
      title: 'Terminal',
      order: 0,
      data: { kind: 'terminal', agentId: null, status: 'Idle' },
    });

    useEditorStore.getState().closeTab('p1', 'tab_t1');

    expect(browserCloseMock).not.toHaveBeenCalled();
  });
});
