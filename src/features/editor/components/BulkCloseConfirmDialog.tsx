import * as React from 'react';

import ConfirmDialog from '@/shared/components/ConfirmDialog';

interface BulkCloseConfirmDialogProps {
  open: boolean;
  dirtyCount: number;
  dirtyPreview: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 批量关闭（Close Others / Close All）未保存确认对话框：
 * 展示待关闭的未保存文件数量与预览，确认后执行关闭。
 */
const BulkCloseConfirmDialog: React.FC<BulkCloseConfirmDialogProps> = ({
  open,
  dirtyCount,
  dirtyPreview,
  onConfirm,
  onCancel,
}) => (
  <ConfirmDialog
    open={open}
    onOpenChange={onCancel}
    title="Unsaved Changes"
    description={
      <>
        You have unsaved changes in {dirtyCount} file{dirtyCount > 1 ? 's' : ''} ({dirtyPreview}
        {dirtyCount > 3 ? ', etc.' : ''}). Closing will discard these changes. Continue?
      </>
    }
    confirmLabel="Close"
    onConfirm={onConfirm}
    danger
  />
);

export default React.memo(BulkCloseConfirmDialog);
