import { useCallback, useEffect, useRef, useState } from 'react';

import { useOverlayStore } from '@/shared/store/overlayStore';

/** 批量关闭确认对话框浮层 id（z-order 专项）。 */
const BULK_CLOSE_OVERLAY_ID = 'bulk-close-confirm';

export interface BulkCloseConfirmationResult {
  bulkCloseOpen: boolean;
  /** 待关闭的未保存文件数量 */
  bulkCloseDirtyCount: number;
  /** 未保存文件名预览（最多前 3 个） */
  bulkCloseDirtyPreview: string;
  /** 批量关闭前询问：记录 dirty 文件名与确认后的关闭动作 */
  requestBulkCloseConfirmation: (dirtyNames: string[], doClose: () => void) => void;
  /** 用户确认关闭：执行 doClose */
  confirmBulkClose: () => void;
  /** 用户取消：不执行 doClose */
  cancelBulkClose: () => void;
}

/**
 * 批量关闭（Close Others / Close All）未保存确认状态机：
 * 确认前不关闭任何 tab，用户确认后才执行 doClose，避免竞态。
 */
export function useBulkCloseConfirmation(): BulkCloseConfirmationResult {
  const [open, setOpen] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [dirtyPreview, setDirtyPreview] = useState('');
  const doCloseRef = useRef<(() => void) | null>(null);

  // 兜底：对话框所属 pane 在打开状态下被卸载（切项目/关 pane）时清除 overlay id，
  // 避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => {
    return () => useOverlayStore.getState().setOverlayOpen(BULK_CLOSE_OVERLAY_ID, false);
  }, []);

  const requestBulkCloseConfirmation = useCallback((dirtyNames: string[], doClose: () => void) => {
    // 浮层上报：对话框打开期间隐藏内容区 Browser webview（z-order 专项）
    useOverlayStore.getState().setOverlayOpen(BULK_CLOSE_OVERLAY_ID, true);
    setDirtyCount(dirtyNames.length);
    setDirtyPreview(dirtyNames.slice(0, 3).join(', '));
    setOpen(true);
    doCloseRef.current = doClose;
  }, []);

  const confirmBulkClose = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(BULK_CLOSE_OVERLAY_ID, false);
    setOpen(false);
    doCloseRef.current?.();
    doCloseRef.current = null;
  }, []);

  const cancelBulkClose = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(BULK_CLOSE_OVERLAY_ID, false);
    setOpen(false);
    doCloseRef.current = null;
  }, []);

  return {
    bulkCloseOpen: open,
    bulkCloseDirtyCount: dirtyCount,
    bulkCloseDirtyPreview: dirtyPreview,
    requestBulkCloseConfirmation,
    confirmBulkClose,
    cancelBulkClose,
  };
}
