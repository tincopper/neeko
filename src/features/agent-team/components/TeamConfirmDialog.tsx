import React from 'react';

import type { TeamRef } from '@/shared/types/team';
import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/Dialog';

import { describeTeamClose, describeTeamDelete, type TeamPrompt } from '../utils/teamPrompts';

/**
 * 团队**破坏性动作**的二次确认（关闭 / 删除）。
 *
 * # 为什么两个动作共用一个弹窗
 *
 * 它们的结构**逐行同构**：一个标题（带队名）、一份逐条后果、取消 + 确认。差别只在文案 ——
 * 而文案的**唯一产出点**在 [`../utils/teamPrompts.ts`](../utils/teamPrompts.ts)
 * （`describeTeamClose` / `describeTeamDelete`）。在这里分两个弹窗 = 两处 Dialog 骨架 +
 * 两份 focus/Esc 行为，而它们本该一致。
 *
 * # 为什么是域内弹窗而不是 `window.confirm`
 *
 * `window.confirm` 会阻塞 JS 线程、无法主题化，且在本应用的 WKWebView 下可能直接返回
 * false —— 需要确认的路径会变成死路。与 `git` 域的丢弃确认同一个做法（`@/ui/Dialog`）。
 *
 * # 为什么文案来自纯函数
 *
 * 关闭团队有三处「看起来做了其实没做」的陷阱（`graceful` 未兑现 / 队长 PTY 不关 /
 * worktree 保留），删除有两处（级联删掉成员与审计 / 不可撤销）。它们的唯一出处是后端
 * `close_notes` 与 `delete_team` 的判据。文案集中在 `utils/teamPrompts.ts` 一处产出，用例
 * 逐句对照后端口径；弹窗自己只负责「问」，**不做任何二次解析、不扩围**
 * （`teamId` 在打开弹窗之前就已定死）。
 *
 * 执行由宿主负责（`onConfirm` 收到的是同一个 intent 对象）：展示与副作用分离，才能各自被测。
 */

/** 破坏性动作的种类。新增一个动作时下面的 `PROMPT_BY_KIND` 会缺一格 ⇒ 编译失败。 */
type TeamDestructiveKind = 'close' | 'delete';

/**
 * 待确认的破坏性动作 = 种类 + 指代。
 *
 * `kind` 决定文案与确认按钮的语义 —— **不是**由调用方传两份文案进来：那样「删除」的后果
 * 就可能被写成「关闭」的后果，而类型系统看不见这件事。
 */
export type TeamDestructiveIntent = TeamRef & { kind: TeamDestructiveKind };

/**
 * 动作 → 文案生产者的**唯一**分派点。
 *
 * 写成 `Record` 而不是三元：`intent.kind === 'delete' ? … : …` 在新增第三种动作时会**静默**
 * 落到「关闭」的文案上（用户看到删除按钮配关闭的后果），而 `Record` 缺一格直接编译失败。
 */
const PROMPT_BY_KIND: Record<TeamDestructiveKind, (name: string) => TeamPrompt> = {
  close: describeTeamClose,
  delete: describeTeamDelete,
};

interface TeamConfirmDialogProps {
  /** `null` = 不展示（没有待确认的动作）。 */
  intent: TeamDestructiveIntent | null;
  onCancel: () => void;
  onConfirm: (intent: TeamDestructiveIntent) => void;
}

const TeamConfirmDialog: React.FC<TeamConfirmDialogProps> = ({ intent, onCancel, onConfirm }) => {
  const prompt = intent ? PROMPT_BY_KIND[intent.kind](intent.name) : null;

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
            {prompt?.confirmLabel ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(TeamConfirmDialog);
