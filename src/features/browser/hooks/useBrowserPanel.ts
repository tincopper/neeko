import { useCallback, useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- browser panel sends terminal commands via terminal feature
import { sendToTerminal } from '@/features/terminal/components/terminalCommands';
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
import { useEditorStore, useProjectStore } from '@/shared/store';
import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import type { FileChangedEvent } from '@/shared/types';
import { fileUrlToFilePath } from '@/shared/utils/browserUtils';
import { canGoBack, canGoForward, recordNavigation } from '@/shared/utils/historyStack';
import {
  decideReclaims,
  DEFAULT_RECLAIM_POLICY,
  type WebviewUsage,
} from '@/shared/utils/reclaimPolicy';

import {
  createBrowserWebview,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserOpenDevtools,
  browserResetZoom,
  browserClose,
  browserSetVisible,
  browserSetBounds,
  openInDefaultBrowser,
} from '../api/browserApi';
import { isAgentCliTab, formatPickerMessage, getThemeColors } from '../components/pickerUtils';
import { BROWSER_PANEL_ID, decideProjectSwitchDock } from '../utils/projectSwitchDock';

import { getProjectBrowserLabel } from './useBrowserConstants';
import { useBrowserPicker } from './useBrowserPicker';

/** Safety-net timeout: auto-refresh even if no git-changed event arrives */
const AUTO_REFRESH_TIMEOUT_MS = 30_000;

/** 闲置 webview 回收检查周期 */
const RECLAIM_CHECK_INTERVAL_MS = 60_000;

/** Payload emitted by Rust when user submits prompt from injected input */
interface PromptSubmittedPayload {
  prompt: string;
  html: string;
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
  const removeBrowserState = useProjectBrowserStore((s) => s.removeState);

  const label = activeProjectId ? getProjectBrowserLabel(activeProjectId) : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCreatingRef = useRef(false);
  const isCreatedRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LOADING_TIMEOUT_MS = 30_000;

  const { isPicking, startPicker, stopPicker, reinjectPicker } = useBrowserPicker({
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

        await createBrowserWebview(activeProjectId, initialUrl, x, y, width, height);

        isCreatedRef.current = true;
        setBrowserState(activeProjectId, {
          isCreated: true,
          label: getProjectBrowserLabel(activeProjectId),
        });

        await browserSetVisible(activeProjectId, true);

        if (containerRef.current) {
          const r = containerRef.current.getBoundingClientRect();
          browserSetBounds(activeProjectId, r.x, r.y, r.width, r.height).catch((err) => {
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
    [activeProjectId, setBrowserState],
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
        await browserNavigate(activeProjectId, newUrl);
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
      await browserNavigate(activeProjectId, currentUrl);
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
      await browserGoBack(activeProjectId);
    } catch (err) {
      console.error('[Browser] Failed to go back:', err);
    }
  }, [activeProjectId]);

  const goForward = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserGoForward(activeProjectId);
    } catch (err) {
      console.error('[Browser] Failed to go forward:', err);
    }
  }, [activeProjectId]);

  const openDevTools = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserOpenDevtools(activeProjectId);
      // DevTools 打开可能触发 webview reposition，立即重新吸附到容器
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        await browserSetBounds(activeProjectId, rect.x, rect.y, rect.width, rect.height);
      }
    } catch (err) {
      console.error('[Browser] Failed to open devtools:', err);
    }
  }, [activeProjectId]);

  // 重置页面缩放为 100%(恢复被 DevTools/误操作放大的页面)
  const resetZoom = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserResetZoom(activeProjectId);
      // 缩放重置后同步容器 bounds，防止 webview 错位
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        await browserSetBounds(activeProjectId, rect.x, rect.y, rect.width, rect.height);
      }
    } catch (err) {
      console.error('[Browser] Failed to reset zoom:', err);
    }
  }, [activeProjectId]);

  const openExternal = useCallback(async () => {
    const currentUrl = browserState?.url;
    if (!currentUrl) return;
    try {
      await openInDefaultBrowser(currentUrl);
    } catch (err) {
      console.error('[Browser] Failed to open in external browser:', err);
    }
  }, [browserState?.url]);

  const updateBounds = useCallback(
    async (rect: DOMRect) => {
      if (!activeProjectId || !isCreatedRef.current) return;
      try {
        await browserSetBounds(activeProjectId, rect.x, rect.y, rect.width, rect.height);
      } catch (err) {
        console.error('[Browser] Failed to update bounds:', err);
      }
    },
    [activeProjectId],
  );

  const setVisible = useCallback(
    async (visible: boolean) => {
      if (!activeProjectId || !isCreatedRef.current) return;
      try {
        await browserSetVisible(activeProjectId, visible);
      } catch (err) {
        console.error('[Browser] Failed to set visible:', err);
      }
    },
    [activeProjectId],
  );

  const destroy = useCallback(async () => {
    if (!activeProjectId) return;
    disarmAutoRefresh();
    if (!isCreatedRef.current) return;
    try {
      await browserClose(activeProjectId);
      isCreatedRef.current = false;
      removeBrowserState(activeProjectId);
    } catch (err) {
      console.error('[Browser] Failed to destroy webview:', err);
    }
  }, [activeProjectId, removeBrowserState, disarmAutoRefresh]);

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
          browserNavigate(activeProjectId, eventUrl).catch((err) => {
            console.error('[Browser] Failed to open new-window url:', err);
          });
          setBrowserState(activeProjectId, { url: eventUrl });
        }
      },
      [activeProjectId, setBrowserState],
    ),
  );

  // Listen: prompt submitted from injected input inside browser webview
  useTauriEvent<PromptSubmittedPayload>(
    BROWSER_PROMPT_SUBMITTED_EVENT,
    useCallback(
      (payload) => {
        const data: PromptSubmittedPayload =
          typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!data?.prompt || !data?.html) return;

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
        const message = formatPickerMessage(data.prompt, data.html, browserUrl);
        sendToTerminal(projectId, message + '\r', editorState.activeTabId);
        armAutoRefresh();
        reinjectPicker();
      },
      [reinjectPicker, armAutoRefresh],
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
        browserSetVisible(prev.activeProjectId, false).catch(() => {});
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
        browserSetVisible(nextProjectId, true).catch(() => {});
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
      if (shouldBeVisible && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        updateBounds(rect);
      }
    } else {
      const { url: pendingUrl } = browserState ?? {};
      if (pendingUrl) {
        // 有 URL 但 webview 未创建:外部 navigateTo 或闲置回收后重建
        navigate(pendingUrl);
      } else {
        // No pending navigation — hide any orphaned webview
        browserSetVisible(activeProjectId, false).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Before page unloads, close the child webview
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (activeProjectId) {
        browserClose(activeProjectId).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeProjectId]);

  // Idle webview reclaim: periodically close non-active webviews beyond the
  // policy threshold. URL/history/title are kept in the store so switching
  // back rebuilds the webview and navigates to the same URL.
  useEffect(() => {
    const checkReclaims = () => {
      const activeProjectId = useProjectStore.getState().activeProjectId;
      const { states } = useProjectBrowserStore.getState();
      const usages: WebviewUsage[] = Object.entries(states).map(([projectId, s]) => ({
        projectId,
        lastActiveAt: s.lastActiveAt,
        isCreated: s.isCreated,
        isActive: projectId === activeProjectId,
      }));
      const reclaimIds = decideReclaims(usages, DEFAULT_RECLAIM_POLICY, Date.now());
      for (const projectId of reclaimIds) {
        browserClose(projectId).catch(() => {});
        useProjectBrowserStore.getState().setPanelState(projectId, {
          isCreated: false,
          isLoading: false,
        });
      }
    };

    const id = setInterval(checkReclaims, RECLAIM_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // 窗口重新获得焦点时同步 bounds(例如关闭 DevTools 独立窗口后回到主窗口)
  useEffect(() => {
    const handleFocus = () => {
      if (!containerRef.current || !isCreatedRef.current) return;
      updateBounds(containerRef.current.getBoundingClientRect());
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [updateBounds]);

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
    resetZoom,
    openExternal,
    updateBounds,
    setVisible,
    startPicker,
    stopPicker,
    destroy,
    setUrl: (url: string) => {
      if (activeProjectId) setBrowserState(activeProjectId, { url });
    },
  };
}
