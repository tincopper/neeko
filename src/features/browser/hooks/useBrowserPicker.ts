import { useState, useCallback, useEffect, type RefObject } from 'react';

import { BROWSER_PICKER_CANCELLED_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { useProjectStore } from '@/shared/store/projectStore';
import { reportFrontendError } from '@/shared/utils/errorReporting';

import { browserStartPicker, browserStopPicker } from '../api/browserApi';
import type { PickerThemeColors } from '../components/pickerUtils';

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

  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // Start element picker mode
  const startPicker = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserStartPicker(
        activeProjectId,
        getThemeColors() as unknown as Record<string, string>,
      );
      setIsPicking(true);
    } catch (err) {
      console.error('[Browser] Failed to start picker:', err);
    }
  }, [activeProjectId, isCreatedRef, getThemeColors]);

  // Stop element picker mode
  const stopPicker = useCallback(async () => {
    if (!activeProjectId || !isCreatedRef.current) return;
    try {
      await browserStopPicker(activeProjectId);
    } catch (err) {
      console.error('[Browser] Failed to stop picker:', err);
    }
    setIsPicking(false);
  }, [activeProjectId, isCreatedRef]);

  // Re-inject picker script (called on navigation, prompt-submit, etc.)
  const reinjectPicker = useCallback(() => {
    if (!activeProjectId) return;
    browserStartPicker(
      activeProjectId,
      getThemeColors() as unknown as Record<string, string>,
    ).catch((err) => reportFrontendError('browser.pickerReinject', err));
  }, [activeProjectId, getThemeColors]);

  // Listen: picker cancelled (Escape / ×) — re-inject picker
  useTauriEvent<void>(BROWSER_PICKER_CANCELLED_EVENT, reinjectPicker);

  // Fallback: periodically re-inject picker script while picker mode is active
  useEffect(() => {
    if (!isPicking) return;
    const id = setInterval(reinjectPicker, 3000);
    return () => clearInterval(id);
  }, [isPicking, reinjectPicker]);

  return { isPicking, startPicker, stopPicker, reinjectPicker };
}
