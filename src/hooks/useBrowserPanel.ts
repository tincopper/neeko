import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBrowserStore } from '../store/browserStore';
import { useDockStore } from '../store/dockStore';

const BROWSER_WEBVIEW_LABEL = 'neeko-browser-panel';

export function useBrowserPanel() {
  const { label, url, isCreated, isLoading, setLabel, setUrl, setCreated, setLoading, reset } =
    useBrowserStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCreatingRef = useRef(false);
  // 标记 webview 是否已被 Rust 侧创建
  const isCreatedRef = useRef(false);

  // Create webview via Rust side (supports on_navigation + on_page_load handlers)
  const createWebview = useCallback(
    async (initialUrl: string) => {
      if (isCreatedRef.current || isCreatingRef.current) return;
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
    [setUrl, setLoading, createWebview],
  );

  // Refresh current page
  const refresh = useCallback(async () => {
    if (!url || !isCreatedRef.current) return;
    setLoading(true);
    try {
      await invoke('browser_navigate', { label: BROWSER_WEBVIEW_LABEL, url });
    } catch (err) {
      console.error('[Browser] Failed to refresh:', err);
      setLoading(false);
    }
  }, [url, setLoading]);

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

  // Destroy webview
  const destroy = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke('browser_close', { label: BROWSER_WEBVIEW_LABEL });
      isCreatedRef.current = false;
      reset();
    } catch (err) {
      console.error('[Browser] Failed to destroy webview:', err);
    }
  }, [reset]);

  // Listen: URL changed (navigation started) — sync address bar
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<string>('browser://url-changed', (event) => {
      setUrl(event.payload);
      setLoading(true);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setUrl, setLoading]);

  // Listen: page fully loaded — stop loading indicator
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<string>('browser://page-loaded', (event) => {
      // page-loaded payload is the final URL (may differ from url-changed after redirects)
      setUrl(event.payload);
      setLoading(false);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setUrl, setLoading]);

  // Listen: target="_blank" link — navigate in current webview
  useEffect(() => {
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
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setUrl]);

  // Listen to dock panel changes, control webview visibility
  useEffect(() => {
    const unsubscribe = useDockStore.subscribe((state) => {
      const activePanelId = state.zones.right?.activePanelId;
      const isVisible = activePanelId === 'browser';
      setVisible(isVisible);
    });

    return () => unsubscribe();
  }, [setVisible]);

  // On mount: sync isCreatedRef from store and restore webview visibility + bounds
  useEffect(() => {
    if (isCreated) {
      isCreatedRef.current = true;
      setVisible(true);
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        updateBounds(rect);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide webview on unmount instead of destroying it
  useEffect(() => {
    return () => {
      setVisible(false);
    };
  }, [setVisible]);

  return {
    label,
    url,
    isCreated,
    isLoading,
    containerRef,
    navigate,
    refresh,
    goBack,
    goForward,
    openDevTools,
    openExternal,
    updateBounds,
    setVisible,
    destroy,
    setUrl,
  };
}
