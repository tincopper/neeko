import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_URL_CHANGED_EVENT, GIT_CHANGED_EVENT } from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
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

describe('useBrowserPanelEvents — file:// 面板的同文件判定走身份抽象', () => {
  /** 取生产代码注册的 file-changed 处理器（该 hook 在测试里被 mock 成 vi.fn）。 */
  function grabFileChangedHandler(): (event: { project_id: string; paths: string[] }) => void {
    const calls = vi.mocked(useFileChangedEvent).mock.calls;
    const handler = calls[calls.length - 1]?.[0];
    if (!handler) throw new Error('file-changed handler not registered');
    return handler as never;
  }

  function setup(projectPath: string, url: string) {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      activeProjectId: 'proj-1',
      projects: [{ id: 'proj-1', path: projectPath } as never],
    });
    useProjectBrowserStore.getState().setPanelState('proj-1', {
      isCreated: true,
      url,
      title: '',
      favicon: '',
      isLoading: false,
      history: { entries: [], index: -1 },
    });
    renderHook(() => useBrowserPanelEvents(makeParams({ refreshRef: { current: refresh } })));
    return { refresh, handler: grabFileChangedHandler() };
  }

  it('变更路径属本文件（canonical 形态）→ 刷新', () => {
    const { refresh, handler } = setup('/repo', 'file:///repo/docs/main.html');

    act(() => {
      handler({ project_id: 'proj-1', paths: ['docs/main.html'] });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('项目根带尾斜杠（非规范但等价）也必须命中：字符串拼接会漏配', () => {
    // 「身份比较」不应依赖各生产者产出同一字符串：`/repo//docs/main.html` 与
    // `/repo/docs/main.html` 指向同一文件，漏配的后果是「面板不刷新、显示过期内容」。
    const { refresh, handler } = setup('/repo/', 'file:///repo/docs/main.html');

    act(() => {
      handler({ project_id: 'proj-1', paths: ['docs/main.html'] });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('事件路径回退为**绝对路径**（watcher strip_prefix 失败）也必须命中', () => {
    // 生产者契约：`strip_prefix(project_root).unwrap_or(&abs_path)` —— 项目根外的文件
    // 会以**绝对路径**下发。拼接 `${projectRoot}/${rel}` 会得到 `/repo//repo/docs/main.html`
    // ⇒ 恒不命中 ⇒ 面板永不刷新（审计 §一 第①条，比尾斜杠更严重）。
    const { refresh, handler } = setup('/repo', 'file:///repo/docs/main.html');

    act(() => {
      handler({ project_id: 'proj-1', paths: ['/repo/docs/main.html'] });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('变更路径重复斜杠（非规范但等价）也必须命中', () => {
    const { refresh, handler } = setup('/repo', 'file:///repo/docs/main.html');

    act(() => {
      handler({ project_id: 'proj-1', paths: ['docs//main.html'] });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('变更路径属别的文件 → 不刷新', () => {
    const { refresh, handler } = setup('/repo', 'file:///repo/docs/main.html');

    act(() => {
      handler({ project_id: 'proj-1', paths: ['docs/other.html'] });
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
