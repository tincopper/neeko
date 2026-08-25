import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { useEditorStore } from '@/shared/store/editorStore';

// 轻量化依赖：terminal 调用 + webview/picker 子 hook 打桩，聚焦 hook 自身逻辑
vi.mock('@/features/terminal', () => ({
  sendToTerminal: vi.fn(),
}));
const { mockDestroy } = vi.hoisted(() => ({
  mockDestroy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/browser/hooks/useBrowserWebview', () => ({
  useBrowserWebview: vi.fn(() => ({
    navigate: vi.fn(),
    refresh: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openDevTools: vi.fn(),
    updateBounds: vi.fn(),
    destroy: mockDestroy,
  })),
}));
vi.mock('@/features/browser/hooks/useBrowserPicker', () => ({
  useBrowserPicker: vi.fn(() => ({
    isPicking: false,
    startPicker: vi.fn(),
    stopPicker: vi.fn(),
    reinjectPicker: vi.fn(),
  })),
}));

import { useBrowserTab } from '../useBrowserTab';

describe('useBrowserTab — per-tab 状态惰性初始化', () => {
  beforeEach(() => {
    useBrowserTabsStore.setState({ states: {} });
  });

  it('渲染前不创建状态；挂载（effect 阶段）后初始化 per-tab 状态（含正确 label）', () => {
    expect(useBrowserTabsStore.getState().states['tab_x']).toBeUndefined();

    const { result } = renderHook(() =>
      useBrowserTab({
        tabKey: 'p1',
        tabId: 'tab_x',
        projectId: 'p1',
        isActive: true,
        showToast: vi.fn(),
      }),
    );

    // 初始渲染无状态时字段降级为空（不崩溃、不写 store）
    expect(result.current.url).toBe('');
    expect(result.current.isCreated).toBe(false);

    // effects flush 后状态被创建（init 在 effect 阶段而非渲染体）
    const state = useBrowserTabsStore.getState().states['tab_x'];
    expect(state?.label).toBe('neeko-browser-tab-tab_x');
    expect(state?.isCreated).toBe(false);
    expect(state?.history).toEqual({ entries: [], index: -1 });
  });

  it('重复挂载（StrictMode 双调用）幂等：状态保持同一 label 且不重复初始化', () => {
    const first = renderHook(() =>
      useBrowserTab({
        tabKey: 'p1',
        tabId: 'tab_y',
        projectId: 'p1',
        isActive: false,
        showToast: vi.fn(),
      }),
    );
    const second = renderHook(() =>
      useBrowserTab({
        tabKey: 'p1',
        tabId: 'tab_y',
        projectId: 'p1',
        isActive: false,
        showToast: vi.fn(),
      }),
    );

    expect(useBrowserTabsStore.getState().states['tab_y']?.label).toBe('neeko-browser-tab-tab_y');
    expect(first.result.current.url).toBe('');
    expect(second.result.current.url).toBe('');
  });
});

describe('useBrowserTab — closePage 关闭页面回收资源', () => {
  beforeEach(() => {
    useBrowserTabsStore.setState({ states: {} });
    useEditorStore.setState({ tabs: {} });
    mockDestroy.mockClear();
  });

  it('销毁 webview、移除 per-tab 状态并清空编辑器 tab 头部', async () => {
    const { result } = renderHook(() =>
      useBrowserTab({
        tabKey: 'p1',
        tabId: 'tab_c',
        projectId: 'p1',
        isActive: true,
        showToast: vi.fn(),
      }),
    );

    // 挂载后 per-tab 状态已惰性创建；置为已创建以通过 closePage 守卫
    const state = useBrowserTabsStore.getState().states['tab_c']!;
    act(() => {
      useBrowserTabsStore.setState({
        states: {
          tab_c: { ...state, isCreated: true, url: 'https://a.com', title: 'A' },
        },
      });
    });
    // 诊断守卫：store 更新必须传导到 hook（isCreatedRef 同步前置条件）
    expect(result.current.isCreated).toBe(true);
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [
            {
              id: 'tab_c',
              projectId: 'p1',
              title: 'A',
              order: 0,
              data: { kind: 'browser', url: 'https://a.com' },
            },
          ],
          activeTabId: 'tab_c',
        },
      },
    });

    await act(async () => {
      await result.current.closePage();
    });

    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(useBrowserTabsStore.getState().states['tab_c']).toBeUndefined();
    const editorTab = useEditorStore.getState().tabs['p1']?.tabs.find((t) => t.id === 'tab_c');
    expect(editorTab?.title).toBe('');
  });

  it('webview 未创建时 closePage 早退，不触发销毁', async () => {
    const { result } = renderHook(() =>
      useBrowserTab({
        tabKey: 'p1',
        tabId: 'tab_d',
        projectId: 'p1',
        isActive: true,
        showToast: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.closePage();
    });

    expect(mockDestroy).not.toHaveBeenCalled();
  });
});
