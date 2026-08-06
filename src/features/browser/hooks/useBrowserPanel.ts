import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- browser panel sends terminal commands via terminal feature
import { sendToTerminal } from '@/features/terminal/components/terminalCommands';
import { GIT_CHANGED_EVENT } from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useEditorStore, useProjectStore } from '@/shared/store';
import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import type { FileChangedEvent } from '@/shared/types';
import { fileUrlToFilePath } from '@/shared/utils/browserUtils';

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
import { isAgentCliTab, formatPickerMessage, getThemeColors } from '../components/pickerUtils';
import { BROWSER_PANEL_ID, decideProjectSwitchDock } from '../utils/projectSwitchDock';

import { getProjectBrowserLabel } from './useBrowserConstants';
import { useBrowserPicker } from './useBrowserPicker';

/** Safety-net timeout: auto-refresh even if no git-changed event arrives */
const AUTO_REFRESH_TIMEOUT_MS = 30_000;

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
    } catch (err) {
      console.error('[Browser] Failed to open devtools:', err);
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

  // Listen: URL changed (navigation started) — sync address bar
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ label: string; url: string }>('browser://url-changed', (event) => {
      const { label: eventLabel, url } = event.payload;
      if (!activeProjectId) return;
      if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
      setBrowserState(activeProjectId, { url, isLoading: true });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeProjectId, setBrowserState]);

  // Listen: page fully loaded — stop loading indicator
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ label: string; url: string }>('browser://page-loaded', (event) => {
      const { label: eventLabel, url } = event.payload;
      if (!activeProjectId) return;
      if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
      disarmLoadingTimeout();
      setBrowserState(activeProjectId, { url, isLoading: false });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeProjectId, setBrowserState, disarmLoadingTimeout]);

  // Listen: target="_blank" link — navigate in current webview
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ label: string; url: string }>('browser://open-url', (event) => {
      const { label: eventLabel, url: eventUrl } = event.payload;
      if (!activeProjectId) return;
      if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
      if (isCreatedRef.current) {
        browserNavigate(activeProjectId, eventUrl).catch((err) => {
          console.error('[Browser] Failed to open new-window url:', err);
        });
        setBrowserState(activeProjectId, { url: eventUrl });
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeProjectId, setBrowserState]);

  // Listen: prompt submitted from injected input inside browser webview
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<PromptSubmittedPayload>('browser://prompt-submitted', (event) => {
      const payload = event.payload;
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
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [reinjectPicker, armAutoRefresh]);

  // Listen: git-changed — auto-refresh browser when armed
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>(GIT_CHANGED_EVENT, (event) => {
      if (pendingRefreshTimer.current === null) return;
      const activeProjectId = useProjectStore.getState().activeProjectId;
      if (event.payload !== activeProjectId) return;
      refreshRef.current();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
      const { url: pendingUrl, isLoading: pendingLoading } = browserState ?? {};
      if (pendingUrl && pendingLoading) {
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
    destroy,
    setUrl: (url: string) => {
      if (activeProjectId) setBrowserState(activeProjectId, { url });
    },
  };
}
