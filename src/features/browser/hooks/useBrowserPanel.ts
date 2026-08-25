import { useCallback, useEffect, useRef } from 'react';

import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { canGoBack, canGoForward, createHistoryStack } from '@/shared/utils/historyStack';

import {
  createBrowserWebview,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserOpenDevtools,
  browserClose,
  browserSetVisible,
  browserSetBounds,
  openInDefaultBrowser,
} from '../api/browserApi';
import { getThemeColors } from '../components/pickerUtils';

import { useBrowserBoundsSync } from './useBrowserBoundsSync';
import { getProjectBrowserLabel } from './useBrowserConstants';
import { useBrowserPanelEvents } from './useBrowserPanelEvents';
import { useBrowserPanelSession } from './useBrowserPanelSession';
import { useBrowserPicker } from './useBrowserPicker';
import { useBrowserReclaimManager } from './useBrowserReclaimManager';

/** Safety-net timeout: auto-refresh even if no git-changed event arrives */
const AUTO_REFRESH_TIMEOUT_MS = 30_000;

/** Options injected by the consuming component */
interface UseBrowserPanelOptions {
  showToast: (message: string, type?: 'info' | 'error') => void;
}

export function useBrowserPanel({ showToast }: UseBrowserPanelOptions) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const browserState = useProjectBrowserStore((s) =>
    activeProjectId ? (s.states[activeProjectId] ?? null) : null,
  );
  const setBrowserState = useProjectBrowserStore((s) => s.setPanelState);

  // 启动统一闲置回收管理器（引用计数单例）：仅用 dock 面板浏览器、从未开过
  // 编辑器 Browser tab 时，面板 webview 也必须被回收，避免跨项目隐藏 webview 累积。
  useBrowserReclaimManager();

  const label = activeProjectId ? getProjectBrowserLabel(activeProjectId) : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCreatingRef = useRef(false);
  const isCreatedRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LOADING_TIMEOUT_MS = 30_000;

  // 容器 → webview bounds 同步（ResizeObserver + window resize + focus，diff 去抖）。
  const { updateBounds, syncBoundsNextFrame } = useBrowserBoundsSync({
    label,
    containerRef,
    isCreatedRef,
  });

  const { isPicking, startPicker, stopPicker, reinjectPicker } = useBrowserPicker({
    label,
    isCreatedRef,
    getThemeColors,
  });

  // ── Auto-refresh after prompt submit ──
  const pendingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmAutoRefresh = useCallback(() => {
    if (pendingRefreshTimer.current !== null) {
      clearTimeout(pendingRefreshTimer.current);
      pendingRefreshTimer.current = null;
    }
  }, []);

  // Create webview via Rust side
  const createWebview = useCallback(
    async (initialUrl: string) => {
      if (!activeProjectId) return;
      if (isCreatedRef.current || isCreatingRef.current) return;
      isCreatingRef.current = true;

      try {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect?.x ?? 0;
        const y = rect?.y ?? 0;
        const width = rect?.width ?? 400;
        const height = rect?.height ?? 300;

        setBrowserState(activeProjectId, { isLoading: true });

        await createBrowserWebview(label!, initialUrl, x, y, width, height);

        isCreatedRef.current = true;
        setBrowserState(activeProjectId, {
          isCreated: true,
          label: getProjectBrowserLabel(activeProjectId),
        });

        await browserSetVisible(label!, true);

        if (containerRef.current) {
          const r = containerRef.current.getBoundingClientRect();
          browserSetBounds(label!, r.x, r.y, r.width, r.height).catch((err) => {
            console.error('[Browser] Failed to sync bounds after creation:', err);
          });
        }
      } catch (err) {
        console.error('[Browser] Failed to create webview:', err);
        if (activeProjectId) setBrowserState(activeProjectId, { isLoading: false });
      } finally {
        isCreatingRef.current = false;
      }
    },
    [activeProjectId, setBrowserState, label],
  );

  const armLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    loadingTimeoutRef.current = setTimeout(() => {
      loadingTimeoutRef.current = null;
      if (activeProjectId) setBrowserState(activeProjectId, { isLoading: false });
    }, LOADING_TIMEOUT_MS);
  }, [activeProjectId, setBrowserState]);

  const disarmLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }, []);

  // Navigate to new URL
  const navigate = useCallback(
    async (newUrl: string) => {
      if (!activeProjectId) return;
      disarmAutoRefresh();
      setBrowserState(activeProjectId, { url: newUrl, isLoading: true });
      armLoadingTimeout();

      if (!isCreatedRef.current) {
        await createWebview(newUrl);
        return;
      }

      try {
        await browserNavigate(label!, newUrl);
      } catch (err) {
        console.error('[Browser] Failed to navigate:', err);
        disarmLoadingTimeout();
        setBrowserState(activeProjectId, { isLoading: false });
      }
    },
    [
      activeProjectId,
      setBrowserState,
      createWebview,
      disarmAutoRefresh,
      armLoadingTimeout,
      disarmLoadingTimeout,
      label,
    ],
  );

  // Refresh current page
  const refresh = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    const currentUrl = useProjectBrowserStore.getState().getPanelState(activeProjectId)?.url;
    if (!currentUrl) return;
    disarmAutoRefresh();
    setBrowserState(activeProjectId, { isLoading: true });
    armLoadingTimeout();
    try {
      await browserNavigate(label!, currentUrl);
    } catch (err) {
      console.error('[Browser] Failed to refresh:', err);
      disarmLoadingTimeout();
      setBrowserState(activeProjectId, { isLoading: false });
    }
  }, [
    activeProjectId,
    setBrowserState,
    disarmAutoRefresh,
    armLoadingTimeout,
    disarmLoadingTimeout,
    label,
  ]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const armAutoRefresh = useCallback(() => {
    disarmAutoRefresh();
    pendingRefreshTimer.current = setTimeout(() => {
      pendingRefreshTimer.current = null;
      refreshRef.current();
    }, AUTO_REFRESH_TIMEOUT_MS);
  }, [disarmAutoRefresh]);

  const goBack = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserGoBack(label!);
    } catch (err) {
      console.error('[Browser] Failed to go back:', err);
    }
  }, [activeProjectId, label]);

  const goForward = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserGoForward(label!);
    } catch (err) {
      console.error('[Browser] Failed to go forward:', err);
    }
  }, [activeProjectId, label]);

  const openDevTools = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    // 提前取 rect 传给 Rust 命令,命令内部 detach 完成后立即恢复 bounds
    const rect = containerRef.current?.getBoundingClientRect();
    try {
      // Rust 命令内部已处理 detach 后的 zoom 补偿与 bounds 恢复,
      // 前端无需重复补偿。
      await browserOpenDevtools(label!, {
        x: rect?.x ?? 0,
        y: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      });
    } catch (err) {
      console.error('[Browser] Failed to open devtools:', err);
    }
  }, [activeProjectId, label]);

  const openExternal = useCallback(async () => {
    const currentUrl = browserState?.url;
    if (!currentUrl) return;
    try {
      await openInDefaultBrowser(currentUrl, activeProjectId ?? undefined);
    } catch (err) {
      console.error('[Browser] Failed to open in external browser:', err);
      showToast('Failed to open in external browser', 'error');
    }
  }, [browserState?.url, activeProjectId, showToast]);

  // 关闭当前页面：销毁 webview 并重置面板状态，回收 webview 占用的内存。
  // panel 容器保留（重新输入 URL / 打开文件时再创建）；不保留 URL，避免挂载
  // 恢复路径（pendingUrl）自动重建 webview，违背回收意图。
  const closePage = useCallback(async () => {
    if (!activeProjectId) return;
    disarmAutoRefresh();
    disarmLoadingTimeout();
    if (isPicking) stopPicker();

    if (isCreatedRef.current) {
      isCreatedRef.current = false;
      try {
        // browser_close 幂等：webview 已不存在视为已关闭。
        if (label) await browserClose(label);
      } catch (err) {
        console.error('[Browser] Failed to close webview:', err);
      }
    }
    setBrowserState(activeProjectId, {
      isCreated: false,
      isLoading: false,
      url: '',
      title: '',
      favicon: '',
      history: createHistoryStack(),
    });
  }, [
    activeProjectId,
    label,
    disarmAutoRefresh,
    disarmLoadingTimeout,
    isPicking,
    stopPicker,
    setBrowserState,
  ]);

  const setVisible = useCallback(
    async (visible: boolean) => {
      if (!activeProjectId || !isCreatedRef.current) return;
      try {
        await browserSetVisible(label!, visible);
        // webview 从隐藏切回显示时,容器位置可能已变化(dock 展开/切换 panel)。
        // 延迟到下一帧 layout 完成后再同步 bounds,避免 hidden→visible 切换时
        // getBoundingClientRect() 返回旧值或 0,导致 webview 错位/顶部被遮挡。
        if (visible) {
          requestAnimationFrame(() => {
            if (!containerRef.current || !isCreatedRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            browserSetBounds(label!, rect.x, rect.y, rect.width, rect.height).catch((err) => {
              console.error('[Browser] Failed to sync bounds after visible:', err);
            });
          });
        }
      } catch (err) {
        console.error('[Browser] Failed to set visible:', err);
      }
    },
    [label, activeProjectId],
  );

  // 外部输入监听层：Tauri 事件 / 文件变更 / store 导航命令（见 useBrowserPanelEvents）
  useBrowserPanelEvents({
    activeProjectId,
    label,
    isCreatedRef,
    pendingRefreshTimerRef: pendingRefreshTimer,
    refreshRef,
    navigateRef,
    disarmLoadingTimeout,
    armAutoRefresh,
    reinjectPicker,
    showToast,
  });

  // 会话生命周期：挂载恢复 / 项目切换 / dock 跟随 / 卸载清理（见 useBrowserPanelSession）
  useBrowserPanelSession({
    activeProjectId,
    label,
    browserState,
    isCreatedRef,
    setVisible,
    navigate,
    syncBoundsNextFrame,
    disarmAutoRefresh,
    disarmLoadingTimeout,
  });

  return {
    label,
    url: browserState?.url ?? '',
    isCreated: browserState?.isCreated ?? false,
    isLoading: browserState?.isLoading ?? false,
    title: browserState?.title ?? '',
    favicon: browserState?.favicon ?? '',
    canGoBack: browserState ? canGoBack(browserState.history) : false,
    canGoForward: browserState ? canGoForward(browserState.history) : false,
    isPicking,
    containerRef,
    navigate,
    refresh,
    goBack,
    goForward,
    openDevTools,
    openExternal,
    closePage,
    updateBounds,
    setVisible,
    startPicker,
    stopPicker,
    setUrl: (url: string) => {
      if (activeProjectId) setBrowserState(activeProjectId, { url });
    },
  };
}
