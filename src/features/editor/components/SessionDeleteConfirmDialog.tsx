import * as React from 'react';

import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/Dialog';

interface SessionDeleteConfirmDialogProps {
  open: boolean;
  /** 会话标题（用户要能确认删的是哪一条）。 */
  title: string;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * 删除一条会话的确认：**一步**，不是「后台运行 / 退出 / 取消」那一套。
 *
 * 两个问题不同：关 tab 问的是「还要不要继续这份工作」（所以有后台运行这个中间选项），
 * 删除问的是「要不要扔掉这一行」—— 没有中间选项可选，问的就是「确定吗」。
 *
 * 说明里点明**进程会被结束、tab 会被关掉**：删除不只是「从列表消失」这一件事。
 */
const SessionDeleteConfirmDialog: React.FC<SessionDeleteConfirmDialogProps> = ({
  open,
  title,
  onDelete,
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
          <DialogTitle>Delete Session</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div>
            <span className="font-medium text-text-primary">{title}</span> will be closed and
            removed from the sidebar. If it is still running, the process ends.
          </div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(SessionDeleteConfirmDialog);
