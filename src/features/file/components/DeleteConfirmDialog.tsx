import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/Dialog';

interface DeleteConfirmDialogProps {
  /** 待删除节点（null 时不展示） */
  target: { path: string; isDir: boolean } | null;
  onCancel: () => void;
  onConfirm: (path: string, isDir: boolean) => void;
}

/** 删除文件/目录的确认对话框（删除不可撤销） */
function DeleteConfirmDialog({ target, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Delete {target?.isDir ? 'Folder' : 'File'}</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{target?.path}&quot;? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="px-4 py-1.5 rounded-md text-sm text-text-secondary bg-bg-primary border border-border hover:bg-bg-hover transition-colors cursor-pointer"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-1.5 rounded-md text-sm text-white bg-accent-red hover:bg-accent-red/90 transition-colors cursor-pointer"
            onClick={() => {
              if (!target) return;
              onConfirm(target.path, target.isDir);
            }}
          >
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default React.memo(DeleteConfirmDialog);
