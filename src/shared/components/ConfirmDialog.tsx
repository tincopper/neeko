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

import { CloseIcon, TrashIcon } from './icons';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  danger = false,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div>{description}</div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            <CloseIcon size={14} />
            Cancel
          </Button>
          <Button
            variant={danger ? 'destructive' : 'primary'}
            size="sm"
            // **只调 `onConfirm`，不先 `onOpenChange(false)`**（2026-10-30 实测缺陷）。
            //
            // `ConfirmHost` 的 `onOpenChange(false)` 会把在途请求按**取消**结算
            // （`confirmStore` 的 fail-closed 契约），于是「点确认」被先当成「取消」：
            // 请求已被 settle 成 false，`onConfirm()` 里的 `resolve(true)` 变成空操作。
            // 后果是**所有** `await confirmAction(...)` 恒为 false —— 调用方静默什么都不做，
            // 屏幕上就是「点了没反应」（历史会话删除 / LSP 导入确认都中招）。
            //
            // 关闭对话框是调用方自己的事：store 路径清 pending 即关闭；其余消费者
            // （Exit / BulkClose / DeleteConfirmDialog）的 onConfirm 各自关闭自己的状态。
            onClick={() => onConfirm()}
          >
            <TrashIcon size={13} />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(ConfirmDialog);
