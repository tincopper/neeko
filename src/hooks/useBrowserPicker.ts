import { useState, useCallback, useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BROWSER_WEBVIEW_LABEL } from "./useBrowserConstants";

import type { PickerThemeColors } from "../components/browser/pickerUtils";

/**
 * useBrowserPicker — manages the browser element picker lifecycle.
 * Extracted from useBrowserPanel.
 */
export function useBrowserPicker(params: {
  isCreatedRef: RefObject<boolean>;
  getThemeColors: () => PickerThemeColors;
}) {
  const { isCreatedRef, getThemeColors } = params;
  const [isPicking, setIsPicking] = useState(false);

  // Start element picker mode
  const startPicker = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke("browser_start_picker", {
        label: BROWSER_WEBVIEW_LABEL,
        themeColors: getThemeColors(),
      });
      setIsPicking(true);
    } catch (err) {
      console.error("[Browser] Failed to start picker:", err);
    }
  }, [isCreatedRef, getThemeColors]);

  // Stop element picker mode
  const stopPicker = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await invoke("browser_stop_picker", { label: BROWSER_WEBVIEW_LABEL });
    } catch (err) {
      console.error("[Browser] Failed to stop picker:", err);
    }
    setIsPicking(false);
  }, [isCreatedRef]);

  // Re-inject picker script (called on navigation, prompt-submit, etc.)
  const reinjectPicker = useCallback(() => {
    invoke("browser_start_picker", {
      label: BROWSER_WEBVIEW_LABEL,
      themeColors: getThemeColors(),
    }).catch(() => {});
  }, [getThemeColors]);

  // Listen: picker cancelled (Escape / ×) — re-inject picker
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<void>("browser://picker-cancelled", () => {
      if (!cancelled) reinjectPicker();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [reinjectPicker]);

  // Fallback: periodically re-inject picker script while picker mode is active
  useEffect(() => {
    if (!isPicking) return;
    const id = setInterval(reinjectPicker, 3000);
    return () => clearInterval(id);
  }, [isPicking, reinjectPicker]);

  return { isPicking, startPicker, stopPicker, reinjectPicker };
}
