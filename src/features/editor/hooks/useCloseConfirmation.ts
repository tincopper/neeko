import { useCallback, useRef, useState } from 'react';

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

  const requestCloseConfirmation = useCallback((name: string): Promise<CloseAction> => {
    setFileName(name);
    setOpen(true);
    return new Promise<CloseAction>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolveCloseConfirmation = useCallback((action: CloseAction) => {
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
