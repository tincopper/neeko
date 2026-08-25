import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_URL_CHANGED_EVENT, GIT_CHANGED_EVENT } from '@/shared/events';
import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { useBrowserPanelEvents } from '../useBrowserPanelEvents';

// 捕获 useTauriEvent 注册的处理器，测试中按事件名模拟触发（避免真实 IPC 订阅）
const listeners = new Map<string, (payload: unknown) => void>();
vi.mock('@/shared/hooks/useTauriEvent', () => ({
  useTauriEvent: (event: string, handler: (payload: unknown) => void) => {
    listeners.set(event, handler);
  },
}));
vi.mock('@/shared/hooks/useFileChangedEvent', () => ({
  useFileChangedEvent: vi.fn(),
}));
vi.mock('../../api/browserApi', () => ({
  browserNavigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/terminal', () => ({
  sendToTerminal: vi.fn(),
}));

type Params = Parameters<typeof useBrowserPanelEvents>[0];
function makeParams(overrides: Partial<Params> = {}): Params {
  const refresh = vi.fn().mockResolvedValue(undefined);
  return {
    activeProjectId: 'proj-1',
    label: 'browser:proj-1',
    isCreatedRef: { current: true },
    pendingRefreshTimerRef: { current: 1 as unknown as ReturnType<typeof setTimeout> },
    refreshRef: { current: refresh },
    navigateRef: { current: vi.fn().mockResolvedValue(undefined) },
    disarmLoadingTimeout: vi.fn(),
    armAutoRefresh: vi.fn(),
    reinjectPicker: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
  useProjectStore.setState({ activeProjectId: 'proj-1', projects: [] });
  useProjectBrowserStore.setState({ states: {} });
  useProjectBrowserStore.getState().setPanelState('proj-1', {
    isCreated: true,
    url: '',
    title: '',
    favicon: '',
    isLoading: false,
    history: { entries: [], index: -1 },
  });
});

describe('useBrowserPanelEvents — URL 变更事件按 label 过滤', () => {
  it('匹配 label 时同步地址栏并进入加载态', () => {
    renderHook(() => useBrowserPanelEvents(makeParams()));

    act(() => {
      listeners.get(BROWSER_URL_CHANGED_EVENT)!({
        label: 'neeko-browser-proj-1',
        url: 'https://a.com',
      });
    });

    const state = useProjectBrowserStore.getState().getPanelState('proj-1');
    expect(state?.url).toBe('https://a.com');
    expect(state?.isLoading).toBe(true);
  });

  it('其他项目 webview 的事件被忽略', () => {
    renderHook(() => useBrowserPanelEvents(makeParams()));

    act(() => {
      listeners.get(BROWSER_URL_CHANGED_EVENT)!({
        label: 'neeko-browser-proj-2',
        url: 'https://b.com',
      });
    });

    expect(useProjectBrowserStore.getState().getPanelState('proj-1')?.url).toBe('');
  });
});

describe('useBrowserPanelEvents — git-changed 武装自动刷新', () => {
  it('武装期间收到本项目事件 → 触发 refreshRef', () => {
    const params = makeParams();
    renderHook(() => useBrowserPanelEvents(params));

    act(() => {
      listeners.get(GIT_CHANGED_EVENT)!('proj-1');
    });

    expect(params.refreshRef.current).toHaveBeenCalledTimes(1);
  });

  it('未武装（timer 为 null）时不刷新', () => {
    const params = makeParams({ pendingRefreshTimerRef: { current: null } });
    renderHook(() => useBrowserPanelEvents(params));

    act(() => {
      listeners.get(GIT_CHANGED_EVENT)!('proj-1');
    });

    expect(params.refreshRef.current).not.toHaveBeenCalled();
  });
});
