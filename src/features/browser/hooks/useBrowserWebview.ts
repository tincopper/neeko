import { useCallback, useEffect, useRef } from 'react';

import {
  BROWSER_OPEN_URL_EVENT,
  BROWSER_PAGE_LOADED_EVENT,
  BROWSER_PAGE_META_EVENT,
  BROWSER_URL_CHANGED_EVENT,
} from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';

import {
  createBrowserWebview,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserOpenDevtools,
  browserClose,
  browserSetVisible,
  browserSetBounds,
} from '../api/browserApi';

import { useBrowserBoundsSync } from './useBrowserBoundsSync';
import { useBrowserReclaimManager } from './useBrowserReclaimManager';

/** 由调用方 store 提供的状态写入口。 */
export type BrowserWebviewSetState = (patch: {
  url?: string;
  isCreated?: boolean;
  isLoading?: boolean;
  title?: string;
  favicon?: string;
}) => void;

interface UseBrowserWebviewOptions {
  /** webview label；null 表示无可用 webview（无项目/无 tab）。 */
  label: string | null;
  /** 读取当前 URL（懒创建/刷新时使用）。需稳定引用。 */
  getUrl: () => string;
  /** store 中记录的 isCreated（外部回收等路径会置 false，用于同步内部 ref）。 */
  isCreated: boolean;
  /** 写入状态。 */
  setState: BrowserWebviewSetState;
  /** 销毁时移除状态。 */
  removeState: () => void;
  /** 当前是否应显示该 webview。 */
  visible: boolean;
  /** DOM 容器 ref，用于测量悬浮 webview 的 bounds。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** URL 变化回调（导航/重定向时记录历史栈）。 */
  onUrlChange?: (url: string) => void;
  /** 页面元信息回调（title/favicon 到达时同步编辑器 tab 标题/图标）。 */
  onPageMeta?: (meta: { title: string; favicon: string }) => void;
  /** 可见性变化回调（用于更新调用方的活跃/最后活跃时间，供闲置回收）。 */
  onVisibleChange?: (visible: boolean) => void;
}

/** 加载安全网超时：无 page-loaded 事件时自动清除 loading 指示。 */
const LOADING_TIMEOUT_MS = 30_000;

/**
 * 核心无 UI 绑定 webview 机制 hook。
 *
 * 封装一个 Tauri child webview 的完整生命周期与交互：懒创建、导航、后退/前进、
 * 刷新、DevTools、外部浏览器、bounds 全链路同步、可见性、URL/page 事件订阅、
 * 销毁与卸载清理。状态通过 `getUrl`/`setState`/`removeState` 注入，由调用方
 * （dock panel / 编辑器 tab）决定状态归属与可见性语义。
 */
export function useBrowserWebview({
  label,
  getUrl,
  isCreated,
  setState,
  removeState,
  visible,
  containerRef,
  onUrlChange,
  onPageMeta,
  onVisibleChange,
}: UseBrowserWebviewOptions) {
  const isCreatingRef = useRef(false);
  const isCreatedRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 确保统一闲置回收管理器运行（panel 与 tab webview 均覆盖；引用计数单实例）。
  useBrowserReclaimManager();

  // 容器 → webview bounds 同步（ResizeObserver + window resize + focus，diff 去抖）。
  const { updateBounds, syncBoundsNextFrame } = useBrowserBoundsSync({
    label,
    containerRef,
    isCreatedRef,
  });

  // 与 store 的 isCreated 同步（外部回收会置 false，驱动内部 ref 复位以便重建）。
  useEffect(() => {
    isCreatedRef.current = isCreated;
  }, [isCreated]);

  // ── Loading timeout ──
  const armLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    loadingTimeoutRef.current = setTimeout(() => {
      loadingTimeoutRef.current = null;
      setState({ isLoading: false });
    }, LOADING_TIMEOUT_MS);
  }, [setState]);

  const disarmLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }, []);

  // Create webview via Rust side（懒创建：有 label 且有容器时才建）
  const createWebview = useCallback(
    async (initialUrl: string) => {
      if (!label) return;
      if (isCreatedRef.current || isCreatingRef.current) return;
      isCreatingRef.current = true;

      try {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect?.x ?? 0;
        const y = rect?.y ?? 0;
        const width = rect?.width ?? 400;
        const height = rect?.height ?? 300;

        setState({ isLoading: true });

        await createBrowserWebview(label, initialUrl, x, y, width, height);

        isCreatedRef.current = true;
        setState({ isCreated: true });

        await browserSetVisible(label, true);

        if (containerRef.current) {
          const r = containerRef.current.getBoundingClientRect();
          browserSetBounds(label, r.x, r.y, r.width, r.height).catch((err) => {
            console.error('[Browser] Failed to sync bounds after creation:', err);
          });
        }
      } catch (err) {
        console.error('[Browser] Failed to create webview:', err);
        setState({ isLoading: false });
      } finally {
        isCreatingRef.current = false;
      }
    },
    [label, setState, containerRef],
  );

  // Navigate to new URL
  const navigate = useCallback(
    async (newUrl: string) => {
      if (!label) return;
      disarmLoadingTimeout();
      setState({ url: newUrl, isLoading: true });
      armLoadingTimeout();

      if (!isCreatedRef.current) {
        await createWebview(newUrl);
        return;
      }

      try {
        await browserNavigate(label, newUrl);
      } catch (err) {
        console.error('[Browser] Failed to navigate:', err);
        disarmLoadingTimeout();
        setState({ isLoading: false });
      }
    },
    [label, setState, createWebview, armLoadingTimeout, disarmLoadingTimeout],
  );

  // Refresh current page
  const refresh = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    const currentUrl = getUrl();
    if (!currentUrl) return;
    disarmLoadingTimeout();
    setState({ isLoading: true });
    armLoadingTimeout();
    try {
      await browserNavigate(label, currentUrl);
    } catch (err) {
      console.error('[Browser] Failed to refresh:', err);
      disarmLoadingTimeout();
      setState({ isLoading: false });
    }
  }, [label, getUrl, setState, armLoadingTimeout, disarmLoadingTimeout]);

  const goBack = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    try {
      await browserGoBack(label);
    } catch (err) {
      console.error('[Browser] Failed to go back:', err);
    }
  }, [label]);

  const goForward = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    try {
      await browserGoForward(label);
    } catch (err) {
      console.error('[Browser] Failed to go forward:', err);
    }
  }, [label]);

  const openDevTools = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    // 提前取 rect 传给 Rust 命令,命令内部 detach 完成后立即恢复 bounds
    const rect = containerRef.current?.getBoundingClientRect();
    try {
      // Rust 命令内部已处理 detach 后的 zoom 补偿与 bounds 恢复,前端无需重复补偿。
      await browserOpenDevtools(label, {
        x: rect?.x ?? 0,
        y: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      });
    } catch (err) {
      console.error('[Browser] Failed to open devtools:', err);
    }
  }, [label, containerRef]);

  const setVisible = useCallback(
    async (nextVisible: boolean) => {
      if (!label || !isCreatedRef.current) return;
      try {
        await browserSetVisible(label, nextVisible);
        // webview 从隐藏切回显示时,容器位置可能已变化。
        // 延迟到下一帧 layout 完成后再同步 bounds,避免 hidden→visible 切换时
        // getBoundingClientRect() 返回旧值或 0,导致 webview 错位/顶部被遮挡。
        if (nextVisible) {
          requestAnimationFrame(() => {
            if (!containerRef.current || !isCreatedRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            browserSetBounds(label, rect.x, rect.y, rect.width, rect.height).catch((err) => {
              console.error('[Browser] Failed to sync bounds after visible:', err);
            });
          });
        }
      } catch (err) {
        console.error('[Browser] Failed to set visible:', err);
      }
    },
    [label, containerRef],
  );

  // ── URL / page 事件订阅（按 label 过滤） ──
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_URL_CHANGED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!label || eventLabel !== label) return;
        setState({ url, isLoading: true });
        onUrlChange?.(url);
      },
      [label, setState, onUrlChange],
    ),
  );

  useTauriEvent<{ label: string; title: string; favicon: string }>(
    BROWSER_PAGE_META_EVENT,
    useCallback(
      ({ label: eventLabel, title, favicon }) => {
        if (!label || eventLabel !== label) return;
        setState({ title, favicon });
        onPageMeta?.({ title, favicon });
      },
      [label, setState, onPageMeta],
    ),
  );

  useTauriEvent<{ label: string; url: string }>(
    BROWSER_PAGE_LOADED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!label || eventLabel !== label) return;
        disarmLoadingTimeout();
        setState({ url, isLoading: false });
      },
      [label, setState, disarmLoadingTimeout],
    ),
  );

  useTauriEvent<{ label: string; url: string }>(
    BROWSER_OPEN_URL_EVENT,
    useCallback(
      ({ label: eventLabel, url: eventUrl }) => {
        if (!label || eventLabel !== label) return;
        if (isCreatedRef.current) {
          browserNavigate(label, eventUrl).catch((err) => {
            console.error('[Browser] Failed to open new-window url:', err);
          });
          setState({ url: eventUrl });
        }
      },
      [label, setState],
    ),
  );

  // ── 懒创建：应显示且有 URL 但未创建时建 webview ──
  useEffect(() => {
    if (!label || !visible || isCreatedRef.current || isCreatingRef.current) return;
    const url = getUrl();
    if (url) {
      void createWebview(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, label, isCreated]);

  // ── visible 驱动 setVisible ──
  useEffect(() => {
    onVisibleChange?.(visible);
    if (!label || !isCreatedRef.current) return;
    setVisible(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, label]);

  // ── 卸载：隐藏而非销毁（保留状态，便于重建） ──
  useEffect(() => {
    return () => {
      disarmLoadingTimeout();
      if (label && isCreatedRef.current) {
        browserSetVisible(label, false).catch((err) => {
          console.error('[Browser] Failed to hide on unmount:', err);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  // 窗口关闭前销毁 webview
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (label && isCreatedRef.current) {
        browserClose(label).catch((err) => console.error('[Browser] close on unload:', err));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [label]);

  const destroy = useCallback(async () => {
    if (!label) return;
    disarmLoadingTimeout();
    if (!isCreatedRef.current) {
      removeState();
      return;
    }
    try {
      await browserClose(label);
      isCreatedRef.current = false;
      removeState();
    } catch (err) {
      console.error('[Browser] Failed to destroy webview:', err);
    }
  }, [label, removeState, disarmLoadingTimeout]);

  return {
    navigate,
    refresh,
    goBack,
    goForward,
    openDevTools,
    updateBounds,
    setVisible,
    syncBoundsNextFrame,
    destroy,
    armLoadingTimeout,
    disarmLoadingTimeout,
  };
}
