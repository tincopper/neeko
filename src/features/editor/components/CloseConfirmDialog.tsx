import * as React from 'react';

import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/Dialog';

interface CloseConfirmDialogProps {
  open: boolean;
  fileName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/**
 * 未保存关闭确认对话框：关闭带有未保存修改的文件 tab 时，
 * 提供「保存 / 不保存 / 取消」三个操作。
 */
const CloseConfirmDialog: React.FC<CloseConfirmDialogProps> = ({
  open,
  fileName,
  onSave,
  onDiscard,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div>
            <span className="font-medium text-text-primary">{fileName}</span> has unsaved changes.
          </div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onDiscard}>
            Don&apos;t Save
          </Button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(CloseConfirmDialog);
