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

interface TerminalCloseConfirmDialogProps {
  open: boolean;
  /** 会话标题（tab 当前显示的名字）。 */
  title: string;
  onBackground: () => void;
  onExit: () => void;
  onCancel: () => void;
}

/**
 * 「会话**正在干活**」时的关闭确认：**后台运行 / 退出进程 / 取消**。
 *
 * 只在 `running` / `awaitingApproval` 时弹出。已经干完的会话（`ready`，进程还在但
 * agent 空闲）不弹 —— 那时关 tab 就是普通的关 tab，弹一个「它还在跑」的框是在说假话。
 *
 * 三个选项对应三种真实后果，不能合并：
 *
 * - **后台运行**：收起界面，进程继续跑。侧栏仍按注册表监控它的状态 —— 这是唯一
 *   「不打断 agent」的选项，也是默认心智（关 tab 不该顺手杀掉正在干活的东西）；
 * - **退出**：结束进程（与关闭一个已结束的 tab 等价）；
 * - **取消**：什么都不做。
 *
 * 「后台运行」排在主按钮位：关 tab 的**主诉求是收起视图**，杀进程是更强的动作，
 * 不该是默认。`Exit` 用破坏性配色，降级为需要主动选择的那一个。
 */
const TerminalCloseConfirmDialog: React.FC<TerminalCloseConfirmDialogProps> = ({
  open,
  title,
  onBackground,
  onExit,
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
          <DialogTitle>Session Still Running</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div>
            <span className="font-medium text-text-primary">{title}</span> is still running. Run it
            in the background, or exit the process?
          </div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onExit}>
            Exit Process
          </Button>
          <Button variant="primary" size="sm" onClick={onBackground}>
            Run in Background
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(TerminalCloseConfirmDialog);
