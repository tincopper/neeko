import { useState, useCallback, useEffect, type RefObject } from 'react';

import { BROWSER_PICKER_CANCELLED_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { reportFrontendError } from '@/shared/utils/errorReporting';

import { browserStartPicker, browserStopPicker } from '../api/browserApi';
import type { PickerThemeColors } from '../components/pickerUtils';

/**
 * useBrowserPicker — manages the browser element picker lifecycle.
 * Extracted from useBrowserPanel.
 */
export function useBrowserPicker(params: {
  /** webview label（panel 用 `neeko-browser-{projectId}`，tab 用 `neeko-browser-tab-{tabId}`）。 */
  label: string | null;
  isCreatedRef: RefObject<boolean>;
  getThemeColors: () => PickerThemeColors;
}) {
  const { label, isCreatedRef, getThemeColors } = params;
  const [isPicking, setIsPicking] = useState(false);

  // Start element picker mode
  const startPicker = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    try {
      await browserStartPicker(label, getThemeColors() as unknown as Record<string, string>);
      setIsPicking(true);
    } catch (err) {
      console.error('[Browser] Failed to start picker:', err);
    }
  }, [label, isCreatedRef, getThemeColors]);

  // Stop element picker mode
  const stopPicker = useCallback(async () => {
    if (!label || !isCreatedRef.current) return;
    try {
      await browserStopPicker(label);
    } catch (err) {
      console.error('[Browser] Failed to stop picker:', err);
    }
    setIsPicking(false);
  }, [label, isCreatedRef]);

  // Re-inject picker script (called on navigation, prompt-submit, etc.)
  const reinjectPicker = useCallback(() => {
    if (!label) return;
    browserStartPicker(label, getThemeColors() as unknown as Record<string, string>).catch((err) =>
      reportFrontendError('browser.pickerReinject', err),
    );
  }, [label, getThemeColors]);

  // Listen: picker cancelled (Esc without composer) — exit picker mode.
  // 设计意图（design.md）：Esc 在无 Composer 打开时退出整个选择模式。此处必须
  // stopPicker 而非 re-inject，否则 Esc 后选择器又回来、看起来「Esc 无效」。
  useTauriEvent<void>(BROWSER_PICKER_CANCELLED_EVENT, stopPicker);

  // 主 webview 兜底：键盘焦点不在浏览器 webview（仅悬停、未点击进页面）时，
  // Esc 到不了注入脚本 document 的 onKey。此处捕获主 webview 的 Esc，
  // 选择器激活时直接退出。
  useEffect(() => {
    if (!isPicking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void stopPicker();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isPicking, stopPicker]);

  // Fallback: periodically re-inject picker script while picker mode is active
  useEffect(() => {
    if (!isPicking) return;
    const id = setInterval(reinjectPicker, 3000);
    return () => clearInterval(id);
  }, [isPicking, reinjectPicker]);

  return { isPicking, startPicker, stopPicker, reinjectPicker };
}
