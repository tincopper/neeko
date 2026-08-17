import { useCallback, useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- browser panel sends terminal commands via terminal feature
import { sendToTerminal } from '@/features/terminal';
import {
  BROWSER_OPEN_URL_EVENT,
  BROWSER_PAGE_LOADED_EVENT,
  BROWSER_PAGE_META_EVENT,
  BROWSER_PROMPT_SUBMITTED_EVENT,
  BROWSER_URL_CHANGED_EVENT,
  GIT_CHANGED_EVENT,
} from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent } from '@/shared/types';
import { fileUrlToFilePath } from '@/shared/utils/browserUtils';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { canGoBack, canGoForward, recordNavigation } from '@/shared/utils/historyStack';

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
import {
  isAgentCliTab,
  formatPickerMessage,
  getThemeColors,
  type PickerElement,
} from '../components/pickerUtils';
import { BROWSER_PANEL_ID, decideProjectSwitchDock } from '../utils/projectSwitchDock';

import { useBrowserBoundsSync } from './useBrowserBoundsSync';
import { getProjectBrowserLabel } from './useBrowserConstants';
import { useBrowserPicker } from './useBrowserPicker';
import { useBrowserReclaimManager } from './useBrowserReclaimManager';

/** Safety-net timeout: auto-refresh even if no git-changed event arrives */
const AUTO_REFRESH_TIMEOUT_MS = 30_000;

/** Payload emitted by Rust when user submits prompt from injected input */
interface PromptSubmittedPayload {
  prompt: string;
  /** 选中元素（单选长度 1，多选长度 N）。 */
  elements: PickerElement[];
  /** 提交方 webview 的 label（新版注入脚本携带；缺失时回退到当前项目路由）。 */
  label?: string;
}

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

  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

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

  // Listen: URL changed (navigation started) — sync address bar + history stack
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_URL_CHANGED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        const prevState = useProjectBrowserStore.getState().getPanelState(activeProjectId);
        setBrowserState(activeProjectId, {
          url,
          isLoading: true,
          history: recordNavigation(prevState.history, url),
        });
      },
      [activeProjectId, setBrowserState],
    ),
  );

  // Listen: page meta (title/favicon) — surface in address bar
  useTauriEvent<{ label: string; title: string; favicon: string }>(
    BROWSER_PAGE_META_EVENT,
    useCallback(
      ({ label: eventLabel, title, favicon }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        setBrowserState(activeProjectId, { title, favicon });
      },
      [activeProjectId, setBrowserState],
    ),
  );

  // Listen: page fully loaded — stop loading indicator
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_PAGE_LOADED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        disarmLoadingTimeout();
        setBrowserState(activeProjectId, { url, isLoading: false });
      },
      [activeProjectId, setBrowserState, disarmLoadingTimeout],
    ),
  );

  // Listen: target="_blank" link — navigate in current webview
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_OPEN_URL_EVENT,
    useCallback(
      ({ label: eventLabel, url: eventUrl }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        if (isCreatedRef.current) {
          browserNavigate(label!, eventUrl).catch((err) => {
            console.error('[Browser] Failed to open new-window url:', err);
          });
          setBrowserState(activeProjectId, { url: eventUrl });
        }
      },
      [activeProjectId, setBrowserState, label],
    ),
  );

  // Listen: prompt submitted from injected input inside browser webview
  useTauriEvent<PromptSubmittedPayload>(
    BROWSER_PROMPT_SUBMITTED_EVENT,
    useCallback(
      (payload) => {
        const data: PromptSubmittedPayload =
          typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!data?.prompt || !Array.isArray(data.elements) || data.elements.length === 0) return;
        // label 过滤：带 label 且不是本 panel 的 webview → 由对应 tab 处理；缺失(旧版)回退。
        if (data.label && data.label !== label) return;

        const projectState = useProjectStore.getState();
        const editorState = useEditorStore.getState();
        const projectId = projectState.activeProjectId;
        if (!projectId) {
          reinjectPicker();
          return;
        }
        const projectTabs = editorState.tabs[projectId];
        if (!isAgentCliTab(projectTabs, editorState.activeTabId)) {
          showToastRef.current('Please switch to an Agent CLI tab', 'error');
          reinjectPicker();
          return;
        }

        const browserUrl = useProjectBrowserStore.getState().getPanelState(projectId)?.url ?? '';
        const message = formatPickerMessage(data.prompt, data.elements, browserUrl);
        sendToTerminal(projectId, message + '\r', editorState.activeTabId);
        armAutoRefresh();
        reinjectPicker();
      },
      [reinjectPicker, armAutoRefresh, label],
    ),
  );

  // Listen: git-changed — auto-refresh browser when armed
  useTauriEvent<string>(
    GIT_CHANGED_EVENT,
    useCallback((payload) => {
      if (pendingRefreshTimer.current === null) return;
      const activeProjectId = useProjectStore.getState().activeProjectId;
      if (payload !== activeProjectId) return;
      refreshRef.current();
    }, []),
  );

  // Listen: file-changed — auto-refresh browser when it has a file:// URL that matches
  useFileChangedEvent((event: FileChangedEvent) => {
    const { project_id, paths } = event;
    if (!paths.length) return;

    const currentUrl = useProjectBrowserStore.getState().getPanelState(project_id)?.url;
    if (!currentUrl?.startsWith('file://')) return;

    const browserFilePath = fileUrlToFilePath(currentUrl);
    if (!browserFilePath) return;

    const state = useProjectStore.getState();
    const project = state.projects.find((p) => p.id === project_id);
    if (!project) return;

    const projectRoot = project.path.replace(/\\/g, '/');
    const browserFileNorm = browserFilePath.replace(/\\/g, '/');
    const matched = paths.some((rel: string) => {
      const abs = `${projectRoot}/${rel}`;
      return abs === browserFileNorm;
    });

    if (matched) {
      refreshRef.current();
    }
  });

  // Listen for external navigateTo() calls when the panel is already mounted
  useEffect(() => {
    const unsubscribe = useProjectBrowserStore.subscribe((state, prev) => {
      if (!activeProjectId) return;
      const current = state.states[activeProjectId];
      const previous = prev.states[activeProjectId];
      if (current && previous && current.url && current.isLoading && current.url !== previous.url) {
        navigateRef.current(current.url);
      }
    });
    return () => unsubscribe();
  }, [activeProjectId]);

  // On project switch: hide previous project's webview, adjust the right dock
  // according to the next project's browser state (opened → restore panel layout,
  // not opened → do not show an empty browser panel), then show its webview if any.
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.activeProjectId === prev.activeProjectId) return;

      // Hide previous project's webview
      if (prev.activeProjectId) {
        browserSetVisible(getProjectBrowserLabel(prev.activeProjectId), false).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }

      const nextProjectId = state.activeProjectId;
      if (!nextProjectId) return;

      const nextState = useProjectBrowserStore.getState().getPanelState(nextProjectId);
      const right = useDockStore.getState().zones.right;
      const action = decideProjectSwitchDock(
        {
          panels: right?.panels ?? [],
          activePanelId: right?.activePanelId ?? null,
          expanded: right?.expanded ?? false,
        },
        nextState.isCreated,
      );

      switch (action.type) {
        case 'none':
          break;
        case 'activate':
          useDockStore.getState().activatePanel('right', action.panelId);
          break;
        case 'add-and-activate':
          useDockStore.getState().togglePanel(action.panelId);
          break;
        case 'collapse':
          useDockStore.getState().togglePanel(BROWSER_PANEL_ID);
          break;
      }

      // Show the new project's webview (if created)
      if (nextState.isCreated) {
        browserSetVisible(getProjectBrowserLabel(nextProjectId), true).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }
      // 记录活跃时间,驱动闲置回收
      useProjectBrowserStore.getState().setPanelState(nextProjectId, {
        lastActiveAt: Date.now(),
      });
    });
    return () => unsubscribe();
  }, []);

  // Listen to dock panel changes, control webview visibility
  useEffect(() => {
    const unsubscribe = useDockStore.subscribe((state) => {
      const zone = state.zones.right;
      const isVisible = zone?.expanded === true && zone?.activePanelId === 'browser';
      setVisible(isVisible);
    });
    return () => unsubscribe();
  }, [setVisible]);

  // On mount: restore or navigate
  useEffect(() => {
    if (!activeProjectId) return;

    if (browserState?.isCreated) {
      isCreatedRef.current = true;
      const dockState = useDockStore.getState();
      const zone = dockState.zones.right;
      const shouldBeVisible = zone?.expanded === true && zone?.activePanelId === 'browser';
      setVisible(shouldBeVisible);
      if (shouldBeVisible) {
        // 延迟到下一帧布局完成后采样,避免 mount 时 flex layout 未稳定
        syncBoundsNextFrame();
      }
    } else {
      const { url: pendingUrl } = browserState ?? {};
      if (pendingUrl) {
        // 有 URL 但 webview 未创建:外部 navigateTo 或闲置回收后重建
        navigate(pendingUrl);
      } else {
        // No pending navigation — hide any orphaned webview
        browserSetVisible(label!, false).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Before page unloads, close the child webview
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (activeProjectId) {
        browserClose(label!).catch((err) => reportFrontendError('browser.close', err));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeProjectId, label]);

  // Hide webview on unmount instead of destroying it
  useEffect(() => {
    return () => {
      disarmAutoRefresh();
      disarmLoadingTimeout();
      if (activeProjectId) setVisible(false);
    };
  }, [activeProjectId, setVisible, disarmAutoRefresh, disarmLoadingTimeout]);

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
    updateBounds,
    setVisible,
    startPicker,
    stopPicker,
    setUrl: (url: string) => {
      if (activeProjectId) setBrowserState(activeProjectId, { url });
    },
  };
}
