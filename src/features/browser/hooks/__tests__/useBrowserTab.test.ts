import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';

// 轻量化依赖：terminal 调用 + webview/picker 子 hook 打桩，聚焦 hook 自身逻辑
vi.mock('@/features/terminal', () => ({
  sendToTerminal: vi.fn(),
}));
vi.mock('./useBrowserWebview', () => ({
  useBrowserWebview: vi.fn(() => ({
    navigate: vi.fn(),
    refresh: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openDevTools: vi.fn(),
    updateBounds: vi.fn(),
    destroy: vi.fn(),
  })),
}));
vi.mock('./useBrowserPicker', () => ({
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
