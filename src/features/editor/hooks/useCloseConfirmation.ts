import { useCallback, useEffect, useRef, useState } from 'react';

import { useOverlayStore } from '@/shared/store/overlayStore';

/** 未保存关闭确认对话框浮层 id（z-order 专项）。 */
const CLOSE_CONFIRM_OVERLAY_ID = 'close-confirm';

/** 未保存关闭确认对话框的用户选择 */
export type CloseAction = 'save' | 'discard' | 'cancel';

export interface CloseConfirmationResult {
  closeConfirmOpen: boolean;
  closeConfirmFileName: string;
  /** 弹出确认对话框并返回用户选择的 Promise（用户操作后 resolve） */
  requestCloseConfirmation: (fileName: string) => Promise<CloseAction>;
  /** 用户点击「保存」 */
  onSave: () => void;
  /** 用户点击「不保存」 */
  onDiscard: () => void;
  /** 用户点击「取消」/ 关闭对话框 */
  onCancel: () => void;
}

/**
 * 单 tab 未保存关闭确认状态机：对话框开关 + Promise 形式的用户选择回传。
 * 与批量关闭（useBulkCloseConfirmation）解耦，供 EditorGroupPane 编排。
 */
export function useCloseConfirmation(): CloseConfirmationResult {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const resolverRef = useRef<((action: CloseAction) => void) | null>(null);

  // 兜底：对话框所属 pane 在打开状态下被卸载（切项目/关 pane）时清除 overlay id，
  // 避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => {
    return () => useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, false);
  }, []);

  const requestCloseConfirmation = useCallback((name: string): Promise<CloseAction> => {
    // 浮层上报：对话框打开期间隐藏内容区 Browser webview（z-order 专项）
    useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, true);
    setFileName(name);
    setOpen(true);
    return new Promise<CloseAction>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolveCloseConfirmation = useCallback((action: CloseAction) => {
    useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, false);
    setOpen(false);
    resolverRef.current?.(action);
    resolverRef.current = null;
  }, []);

  const onSave = useCallback(() => resolveCloseConfirmation('save'), [resolveCloseConfirmation]);
  const onDiscard = useCallback(
    () => resolveCloseConfirmation('discard'),
    [resolveCloseConfirmation],
  );
  const onCancel = useCallback(
    () => resolveCloseConfirmation('cancel'),
    [resolveCloseConfirmation],
  );

  return {
    closeConfirmOpen: open,
    closeConfirmFileName: fileName,
    requestCloseConfirmation,
    onSave,
    onDiscard,
    onCancel,
  };
}
