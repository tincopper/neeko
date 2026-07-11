import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Tracks whether the Tauri window is currently in fullscreen mode.
 *
 * On macOS this is used to adjust the title bar padding: when fullscreen
 * the native traffic-light buttons are hidden, so the Neeko icon can
 * shift left into that area.  When the window exits fullscreen the
 * padding is restored.
 */
export function useFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    try {
      const appWindow = getCurrentWindow();

      // Initial state
      appWindow
        .isFullscreen()
        .then(setIsFullscreen)
        .catch(() => {});

      // Fullscreen transitions fire a resize event in Tauri, so we
      // re-query the fullscreen flag on every resize.
      appWindow
        .onResized(() => {
          appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
        })
        .then((fn) => {
          unlistenFn = fn;
        })
        .catch(() => {});
    } catch {
      // Not running inside a Tauri window (e.g. unit tests)
    }

    return () => {
      unlistenFn?.();
    };
  }, []);

  return isFullscreen;
}
