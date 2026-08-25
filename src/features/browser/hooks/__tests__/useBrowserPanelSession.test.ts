import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { browserSetVisible } from '../../api/browserApi';
import { useBrowserPanelSession } from '../useBrowserPanelSession';

vi.mock('../../api/browserApi', () => ({
  browserClose: vi.fn().mockResolvedValue(undefined),
  browserSetVisible: vi.fn().mockResolvedValue(undefined),
}));

type Params = Parameters<typeof useBrowserPanelSession>[0];
function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    activeProjectId: 'proj-1',
    label: 'browser:proj-1',
    browserState: null,
    isCreatedRef: { current: false },
    setVisible: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    syncBoundsNextFrame: vi.fn(),
    disarmAutoRefresh: vi.fn(),
    disarmLoadingTimeout: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ activeProjectId: 'proj-1', projects: [] });
  useProjectBrowserStore.setState({ states: {} });
});

describe('useBrowserPanelSession — 项目切换 webview 显隐', () => {
  it('proj-1 → proj-2（已创建）隐藏旧、显示新、记录活跃时间', () => {
    renderHook(() => useBrowserPanelSession(makeParams()));
    vi.mocked(browserSetVisible).mockClear(); // 清掉 mount 期兜底隐藏调用

    act(() => {
      useProjectBrowserStore.getState().setPanelState('proj-2', {
        isCreated: true,
        url: 'https://a.com',
        isLoading: false,
      });
      useProjectStore.setState({ activeProjectId: 'proj-2' });
    });

    expect(browserSetVisible).toHaveBeenCalledWith('neeko-browser-proj-1', false);
    expect(browserSetVisible).toHaveBeenCalledWith('neeko-browser-proj-2', true);
    expect(useProjectBrowserStore.getState().getPanelState('proj-2')?.lastActiveAt).toBeGreaterThan(
      0,
    );
  });
});

describe('useBrowserPanelSession — 卸载清理', () => {
  it('unmount 时解除武装并隐藏 webview', () => {
    const params = makeParams();
    const { unmount } = renderHook(() => useBrowserPanelSession(params));

    unmount();

    expect(params.disarmAutoRefresh).toHaveBeenCalledTimes(1);
    expect(params.disarmLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(params.setVisible).toHaveBeenCalledWith(false);
  });
});
