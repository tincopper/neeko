import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBrowserStore } from '../store/browserStore';
import { useDockStore } from '../store/dockStore';
import { useAppStore } from '../store/appStore';
import { sendToTerminal } from '../components/terminal';
import { isAgentCliTab, formatPickerMessage, getThemeColors } from '../components/browser/pickerUtils';

const BROWSER_WEBVIEW_LABEL = 'neeko-browser-panel';

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
  const { label, url, isCreated, isLoading, setLabel, setUrl, setCreated, setLoading, reset } =
    useBrowserStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCreatingRef = useRef(false);
  const isCreatedRef = useRef(false);

  const [isPicking, setIsPicking] = useState(false);
  // Keep showToast stable across renders via ref (avoids re-subscribing listeners)
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // ── Auto-refresh after prompt submit ──
  // When armed, the next "git-changed" event (or the 30-sec timeout) triggers a page refresh.
  const pendingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmAutoRefresh = useCallback(() => {
    if (pendingRefreshTimer.current !== null) {
      clearTimeout(pendingRefreshTimer.current);
      pendingRefreshTimer.current = null;
    }
  }, []);

  // Create webview via Rust side (supports on_navigation + on_page_load handlers)
  const createWebview = useCallback(
    async (initialUrl: string) => {
      if (isCreatedRef.current || isCreatingRef.current) {
        return;
      }
      isCreatingRef.current = true;

      try {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect?.x ?? 0;
        const y = rect?.y ?? 0;
        const width = rect?.width ?? 400;
        const height = rect?.height ?? 300;

        setLoading(true);

        await invoke('create_browser_webview', {
          url: initialUrl,
          x,
          y,
          width,
          height,
        });

        isCreatedRef.current = true;
        setLabel(BROWSER_WEBVIEW_LABEL);
        setCreated(true);

        // Ensure the webview is visible. A concurrent mount-time effect may have
        // issued browser_set_visible(false) to clean up a post-refresh orphan;
        // issuing set_visible(true) here guarantees the newly-created webview is
        // always shown regardless of IPC arrival order.
        await invoke('browser_set_visible', { label: BROWSER_WEBVIEW_LABEL, visible: true });

        // Sync bounds immediately after creation
        if (containerRef.current) {
          const r = containerRef.current.getBoundingClientRect();
          invoke('browser_set_bounds', {
            label: BROWSER_WEBVIEW_LABEL,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          }).catch((err) => {
            console.error('[Browser] Failed to sync bounds after creation:', err);
          });
        }
      } catch (err) {
        console.error('[Browser] Failed to create webview:', err);
        setLoading(false);
      } finally {
        isCreatingRef.current = false;
      }
    },
    [setLabel, setCreated, setLoading],
  );

  // Navigate to new URL
  const navigate = useCallback(
    async (newUrl: string) => {
      disarmAutoRefresh();
      setUrl(newUrl);
      setLoading(true);

      if (!isCreatedRef.current) {
        await createWebview(newUrl);
        return;
      }

      try {
        await invoke('browser_navigate', { label: BROWSER_WEBVIEW_LABEL, url: newUrl });
      } catch (err) {
        console.error('[Browser] Failed to navigate:', err);
        setLoading(false);
      }
    },
    [setUrl, setLoading, createWebview, disarmAutoRefresh],
  );

  // Refresh current page
  const refresh = useCallback(async () => {
    if (!url || !isCreatedRef.current) return;
    disarmAutoRefresh();
    setLoading(true);
    try {
      await invoke('browser_navigate', { label: BROWSER_WEBVIEW_LABEL, url });
    } catch (err) {
      console.error('[Browser] Failed to refresh:', err);
      setLoading(false);
    }
  }, [url, setLoading, disarmAutoRefresh]);

  // Stable ref so arm/listener can call refresh without re-subscribing
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Stable ref for navigate — prevents the store subscription below from
  // re-subscribing every time navigate's useCallback dependencies change,
  // which could cause duplicate navigation on the same url update.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  /** Arm auto-refresh: wait for git-changed or timeout, then refresh the webview */
  const armAutoRefresh = useCallback(() => {
    disarmAutoRefresh();
    pendingRefreshTimer.current = setTimeout(() => {
      pendingRefreshTimer.current = null;
      refreshRef.current();
    }, AUTO_REFRESH_TIMEOUT_MS);
  }, [disarmAutoRefresh]);

  // Go back
  const goBack = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_go_back', { label: BROWSER_WEBVIEW_LABEL });
    } catch (err) {
      console.error('[Browser] Failed to go back:', err);
    }
  }, []);

  // Go forward
  const goForward = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_go_forward', { label: BROWSER_WEBVIEW_LABEL });
    } catch (err) {
      console.error('[Browser] Failed to go forward:', err);
    }
  }, []);

  // Open DevTools
  const openDevTools = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_open_devtools', { label: BROWSER_WEBVIEW_LABEL });
    } catch (err) {
      console.error('[Browser] Failed to open devtools:', err);
    }
  }, []);

  // Open current URL in system default browser
  const openExternal = useCallback(async () => {
    if (!url) return;
    try {
      await invoke('open_in_default_browser', { url });
    } catch (err) {
      console.error('[Browser] Failed to open in external browser:', err);
    }
  }, [url]);

  // Update webview position and size
  const updateBounds = useCallback(async (rect: DOMRect) => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_set_bounds', {
        label: BROWSER_WEBVIEW_LABEL,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    } catch (err) {
      console.error('[Browser] Failed to update bounds:', err);
    }
  }, []);

  // Set visibility
  const setVisible = useCallback(async (visible: boolean) => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_set_visible', { label: BROWSER_WEBVIEW_LABEL, visible });
    } catch (err) {
      console.error('[Browser] Failed to set visible:', err);
    }
  }, []);

  // Start element picker mode
  const startPicker = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_start_picker', {
        label: BROWSER_WEBVIEW_LABEL,
        themeColors: getThemeColors(),
      });
      setIsPicking(true);

    } catch (err) {
      console.error('[Browser] Failed to start picker:', err);
    }
  }, []);

  // Stop element picker mode
  const stopPicker = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_stop_picker', { label: BROWSER_WEBVIEW_LABEL });
    } catch (err) {
      console.error('[Browser] Failed to stop picker:', err);
    }
    setIsPicking(false);
  }, []);

  // Destroy webview
  const destroy = useCallback(async () => {
    disarmAutoRefresh();
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_close', { label: BROWSER_WEBVIEW_LABEL });
      isCreatedRef.current = false;
      reset();
    } catch (err) {
      console.error('[Browser] Failed to destroy webview:', err);
    }
  }, [reset, disarmAutoRefresh]);

  // Listen: URL changed (navigation started) — sync address bar
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>('browser://url-changed', (event) => {
      setUrl(event.payload);
      setLoading(true);
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setUrl, setLoading]);

  // Listen: page fully loaded — stop loading indicator
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>('browser://page-loaded', (event) => {
      setUrl(event.payload);
      setLoading(false);
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setUrl, setLoading]);

  // Listen: target="_blank" link — navigate in current webview
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>('browser://open-url', (event) => {
      const newUrl = event.payload;
      if (isCreatedRef.current) {
        invoke('browser_navigate', { label: BROWSER_WEBVIEW_LABEL, url: newUrl }).catch((err) => {
          console.error('[Browser] Failed to open new-window url:', err);
        });
        setUrl(newUrl);
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setUrl]);

  // Re-inject picker script (shared helper to reduce duplication)
  const reinjectPicker = useCallback(() => {
    invoke('browser_start_picker', {
      label: BROWSER_WEBVIEW_LABEL,
      themeColors: getThemeColors(),
    }).catch(() => {});
  }, []);

  // Listen: prompt submitted from injected input inside browser webview
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<PromptSubmittedPayload>('browser://prompt-submitted', (event) => {
      const payload = event.payload;
      const data: PromptSubmittedPayload =
        typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!data?.prompt || !data?.html) return;

      // Check if current active tab is agent CLI
      const appState = useAppStore.getState();
      const projectId = appState.activeProjectId;
      if (!projectId) { reinjectPicker(); return; }
      const projectTabs = appState.tabs[projectId];
      if (!isAgentCliTab(projectTabs, appState.activeTabId)) {
        showToastRef.current('Please switch to an Agent CLI tab', 'error');
        reinjectPicker();
        return;
      }

      const browserUrl = useBrowserStore.getState().url;
      const message = formatPickerMessage(data.prompt, data.html, browserUrl);
      sendToTerminal(projectId, message + '\r', appState.activeTabId);
      armAutoRefresh();
      reinjectPicker();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [reinjectPicker, armAutoRefresh]);

  // Listen: git-changed — auto-refresh browser when armed (after prompt submit)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>('git-changed', (event) => {
      // Only react when auto-refresh is armed
      if (pendingRefreshTimer.current === null) return;
      // Only refresh for the active project
      const activeProjectId = useAppStore.getState().activeProjectId;
      if (event.payload !== activeProjectId) return;
      // Trigger refresh and disarm
      refreshRef.current();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Listen: picker cancelled (Escape / ✕ / click-outside) — re-inject picker
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<void>('browser://picker-cancelled', () => {
      reinjectPicker();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [reinjectPicker]);

  // Fallback: while picker mode is active, periodically re-inject the picker
  // script. The script is a no-op when `window.__NEEKO_PICKER__` already exists,
  // so under normal conditions this has negligible cost. If the picker was lost
  // (e.g. page navigation, JS error, timing race) this automatically restores it.
  useEffect(() => {
    if (!isPicking) return;
    const id = setInterval(reinjectPicker, 3000);
    return () => clearInterval(id);
  }, [isPicking, reinjectPicker]);

  // Listen for external navigateTo() calls when the panel is already mounted.
  // navigateTo() sets url + isLoading=true in the store but cannot call
  // navigate() directly (it lives outside React). This subscription detects
  // a url change combined with isLoading=true and drives the actual navigation.
  // No loop risk: navigate() internally calls setUrl() with the same value,
  // so state.url !== prev.url is false on that update and the callback skips.
  // Uses navigateRef ([] deps) so the subscription is created once and always
  // calls the latest navigate without risk of double-subscription.
  useEffect(() => {
    const unsubscribe = useBrowserStore.subscribe((state, prev) => {
      if (state.url && state.isLoading && state.url !== prev.url) {
        navigateRef.current(state.url);
      }
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen to dock panel changes, control webview visibility
  useEffect(() => {
    const unsubscribe = useDockStore.subscribe((state) => {
      const activePanelId = state.zones.right?.activePanelId;
      const isVisible = activePanelId === 'browser';
      setVisible(isVisible);
    });

    return () => unsubscribe();
  }, [setVisible]);

  // On mount: two responsibilities:
  //
  // 1. Restore: if isCreated is true (tab-switch back to browser), sync the
  //    ref and restore visibility + bounds.
  //
  // 2. Navigate: if the store already has a url with isLoading=true it means
  //    navigateTo() was called externally (e.g. Open in Browser) before this
  //    component mounted. Execute the navigation now that we have a live hook.
  //
  // 3. Orphan cleanup: if neither applies, hide any webview that may have
  //    survived a page refresh (isCreated is false in store but native webview
  //    still exists from the previous session).
  useEffect(() => {
    if (isCreated) {
      isCreatedRef.current = true;
      setVisible(true);
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        updateBounds(rect);
      }
    } else {
      // Read directly from store snapshot to avoid stale closure
      const { url: pendingUrl, isLoading: pendingLoading } = useBrowserStore.getState();
      if (pendingUrl && pendingLoading) {
        // navigateTo() was called before we mounted — execute the navigation now
        navigate(pendingUrl);
      } else {
        // No pending navigation — hide any orphaned webview from a prior session
        invoke('browser_set_visible', { label: BROWSER_WEBVIEW_LABEL, visible: false }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Before the page unloads (refresh / navigation), attempt to close the child
  // webview so it doesn't become an orphan. The async invoke may not complete
  // in time, but the mount-time safety-net above covers that case.
  useEffect(() => {
    const handleBeforeUnload = () => {
      invoke('browser_close', { label: BROWSER_WEBVIEW_LABEL }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Hide webview on unmount instead of destroying it; clean up auto-refresh timer
  useEffect(() => {
    return () => {
      disarmAutoRefresh();
      setVisible(false);
    };
  }, [setVisible, disarmAutoRefresh]);

  return {
    label,
    url,
    isCreated,
    isLoading,
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
    setUrl,
  };
}
