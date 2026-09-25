import React from 'react';

import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/Dialog';

import type { DiscardIntent } from '../utils/discardIntent';
import { describeDiscard } from '../utils/discardIntent';

interface DiscardConfirmDialogProps {
  /**
   * 待确认的丢弃意图（`null` 时不展示）。
   *
   * `paths` 在打开弹窗之前就已定死 —— 文案描述的范围与真正执行的集合同源，
   * 弹窗不做任何二次解析（否则二次确认就成了谎言）。
   */
  intent: DiscardIntent | null;
  onCancel: () => void;
  onConfirm: (intent: DiscardIntent) => void;
}

/**
 * 丢弃变更的二次确认对话框。
 *
 * 风险文案按类别分化：tracked 可从 HEAD 复原，unversioned 在 git 里没有副本、
 * 删除即永久丢失（见 `describeDiscard`）。对话框只负责「问」，执行由宿主负责 ——
 * 保持展示与副作用分离，便于独立测试。
 */
const DiscardConfirmDialog: React.FC<DiscardConfirmDialogProps> = ({
  intent,
  onCancel,
  onConfirm,
}) => {
  const prompt = intent ? describeDiscard(intent) : null;

  return (
    <Dialog
      open={intent !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-[13px]">{prompt?.description}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!intent) return;
              onConfirm(intent);
            }}
          >
            {prompt?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(DiscardConfirmDialog);
