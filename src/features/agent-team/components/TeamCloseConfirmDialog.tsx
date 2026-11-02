import React from 'react';

import type { TeamSummary } from '@/shared/types/team';
import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/Dialog';

import { describeTeamClose } from '../utils/teamClose';

/**
 * 关闭团队的**二次确认**（后果在按下去之前就写清楚）。
 *
 * # 为什么是域内弹窗而不是 `window.confirm`
 *
 * `window.confirm` 会阻塞 JS 线程、无法主题化，且在本应用的 WKWebView 下可能直接返回
 * false —— 需要确认的路径会变成死路。与 `git` 域的丢弃确认同一个做法（`@/ui/Dialog`）。
 *
 * # 为什么文案来自纯函数
 *
 * 关闭团队有三处「看起来做了其实没做」的陷阱（`graceful` 未兑现 / 队长 PTY 不关 /
 * worktree 保留），它们的唯一出处是后端 `close_notes`。文案集中在
 * [`describeTeamClose`](../utils/teamClose.ts) 一处产出，用例逐句对照后端口径；
 * 弹窗自己只负责「问」，**不做任何二次解析、不扩围**（`teamId` 在打开弹窗之前就已定死）。
 *
 * 执行由宿主负责（`onConfirm` 收到的是同一个 intent 对象）：展示与副作用分离，才能各自被测。
 */

/** 待确认的关闭目标（形态与列表行 / 快照头的必填字段一致，不多带）。 */
export type TeamCloseIntent = Pick<TeamSummary, 'teamId' | 'name'>;

interface TeamCloseConfirmDialogProps {
  /** `null` = 不展示（没有待确认的关闭）。 */
  intent: TeamCloseIntent | null;
  onCancel: () => void;
  onConfirm: (intent: TeamCloseIntent) => void;
}

const TeamCloseConfirmDialog: React.FC<TeamCloseConfirmDialogProps> = ({
  intent,
  onCancel,
  onConfirm,
}) => {
  const prompt = intent ? describeTeamClose(intent.name) : null;

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
        <DialogDescription asChild>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-meta">
            {prompt?.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!intent) return;
              onConfirm(intent);
            }}
          >
            {prompt?.confirmLabel ?? '确认关闭'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(TeamCloseConfirmDialog);
