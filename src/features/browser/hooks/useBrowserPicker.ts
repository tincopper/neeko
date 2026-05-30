import { useState, useCallback, useEffect, type RefObject } from "react";
import { browserStartPicker, browserStopPicker } from "../api/browserApi";
import { listen } from "@tauri-apps/api/event";
import { BROWSER_WEBVIEW_LABEL } from "./useBrowserConstants";

import type { PickerThemeColors } from "../components/pickerUtils";

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
      await browserStartPicker(BROWSER_WEBVIEW_LABEL, getThemeColors() as unknown as Record<string, string>);
      setIsPicking(true);
    } catch (err) {
      console.error("[Browser] Failed to start picker:", err);
    }
  }, [isCreatedRef, getThemeColors]);

  // Stop element picker mode
  const stopPicker = useCallback(async () => {
    if (!isCreatedRef.current) return;
    try {
      await browserStopPicker(BROWSER_WEBVIEW_LABEL);
    } catch (err) {
      console.error("[Browser] Failed to stop picker:", err);
    }
    setIsPicking(false);
  }, [isCreatedRef]);

  // Re-inject picker script (called on navigation, prompt-submit, etc.)
  const reinjectPicker = useCallback(() => {
    browserStartPicker(BROWSER_WEBVIEW_LABEL, getThemeColors() as unknown as Record<string, string>).catch(() => {});
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
