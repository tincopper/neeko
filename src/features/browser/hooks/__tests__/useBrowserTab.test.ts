import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { armProjectAutoRefresh, disarmProjectAutoRefresh } from '@/shared/utils/browserAutoRefresh';

// 轻量化依赖：terminal 调用 + webview/picker 子 hook 打桩，聚焦 hook 自身逻辑
vi.mock('@/features/terminal', () => ({
  sendToTerminal: vi.fn(),
}));
const { mockDestroy, mockRefresh } = vi.hoisted(() => ({
  mockDestroy: vi.fn().mockResolvedValue(undefined),
  mockRefresh: vi.fn(),
}));
vi.mock('@/features/browser/hooks/useBrowserWebview', () => ({
  useBrowserWebview: vi.fn(() => ({
    navigate: vi.fn(),
    refresh: mockRefresh,
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
vi.mock('@/shared/hooks/useFileChangedEvent', () => ({ useFileChangedEvent: vi.fn() }));

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

/**
 * `file://` tab 的自动刷新依赖「变更路径命中本 tab 的文件」这一判定。
 *
 * 生产者契约（`src-tauri/src/common/file/watcher/debounce.rs`）：事件路径**正常为项目相对**，
 * `strip_prefix` 失败时**回退为绝对路径**。因此拼接 `${projectRoot}/${rel}` 的写法在回退场景
 * **恒不命中**（`/repo//repo/docs/a.html`）—— 后果是「tab 不刷新、显示过期内容」。
 * 与 `useBrowserPanelEvents` 的同一缺陷同因，判定必须走身份所有者。
 */
describe('useBrowserTab — file:// tab 的变更命中判定走身份抽象', () => {
  const TAB_ID = 'tab_f';
  const TAB_KEY = 'p1';
  const FILE_URL = 'file:///repo/docs/main.html';

  function grabFileChangedHandler(): (event: { project_id: string; paths: string[] }) => void {
    const calls = vi.mocked(useFileChangedEvent).mock.calls;
    const handler = calls[calls.length - 1]?.[0];
    if (!handler) throw new Error('file-changed handler not registered');
    return handler as never;
  }

  function setup(projectPath: string) {
    useBrowserTabsStore.setState({ states: {} });
    useBrowserTabsStore.getState().setTabState(TAB_ID, {
      label: `neeko-browser-tab-${TAB_ID}`,
      url: FILE_URL,
      isCreated: true,
      history: { entries: [FILE_URL], index: 0 },
    });
    useProjectStore.setState({
      activeProjectId: 'p1',
      projects: [{ id: 'p1', path: projectPath } as never],
    });
    armProjectAutoRefresh('p1');

    renderHook(() =>
      useBrowserTab({
        tabKey: TAB_KEY,
        tabId: TAB_ID,
        projectId: 'p1',
        isActive: true,
        showToast: vi.fn(),
      }),
    );
    return grabFileChangedHandler();
  }

  beforeEach(() => {
    disarmProjectAutoRefresh('p1');
    mockRefresh.mockClear();
    vi.mocked(useFileChangedEvent).mockClear();
  });

  it('项目相对路径（正常形态）→ 刷新', () => {
    const handler = setup('/repo');

    act(() => {
      handler({ project_id: 'p1', paths: ['docs/main.html'] });
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('事件路径回退为**绝对路径**（strip_prefix 失败）→ 仍须刷新', () => {
    const handler = setup('/repo');

    act(() => {
      handler({ project_id: 'p1', paths: ['/repo/docs/main.html'] });
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('项目根带尾斜杠 / 相对路径重复斜杠 → 仍须刷新', () => {
    const handler = setup('/repo/');

    act(() => {
      handler({ project_id: 'p1', paths: ['docs//main.html'] });
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('变更路径属别的文件 → 不刷新', () => {
    const handler = setup('/repo');

    act(() => {
      handler({ project_id: 'p1', paths: ['docs/other.html'] });
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
