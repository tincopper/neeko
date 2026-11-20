import React from 'react';

import { Dialog, DialogContent } from '@/ui/Dialog';

import type { StagePlan, UpdateWorkItemParams } from '../types';

import WorkItemForm, { type WorkItemCreateDraft, type WorkItemDialogIntent } from './WorkItemForm';

/**
 * 新建 / 编辑工作项的对话框外壳（字段与提交在 [`WorkItemForm`](./WorkItemForm.tsx)）。
 *
 * # 外壳只做三件事
 *
 * 1. `intent === null` ⇒ 关闭（Radix 的 `open` 是唯一开关，父组件不另存一个 `open` 布尔）；
 * 2. Esc / 遮罩 / × ⇒ 走 `onOpenChange(false)` ⇒ `onClose()`（一处结算，不各写一份）；
 * 3. 用 `key` 让「换一条工作项再打开」**重新挂载**表单体。
 *
 * 第三件是必要的：表单初值只在挂载时从 intent 取一次（见 `WorkItemForm` 的文件头）。没有 `key`
 * 时从一个工作项切到另一个（`intent` 变了但组件没卸载）会保留上一个的输入 —— 保存下去就是
 * 把 A 的标题写到 B 上。`create` 也带 `key`，因为它按「预填的 stage」区分：从 Ready 列点
 * `+ Add` 与从 Done 列点，打开的应该是两个不同初值的表单。
 *
 * 这里**不**做提交：`onCreate` / `onUpdate` 由宿主执行（失败要把错误回填到这里，所以错误也是
 * 一个受控 prop，而不是本组件的内部状态）。
 */
interface WorkItemDialogProps {
  /** `null` = 关闭。 */
  intent: WorkItemDialogIntent | null;
  plan: StagePlan | null;
  submitting: boolean;
  /** 提交失败的原文（宿主捕获后回传；成功后对话框会被关掉）。 */
  error: string | null;
  onCreate: (draft: WorkItemCreateDraft) => void;
  onUpdate: (params: UpdateWorkItemParams) => void;
  onClose: () => void;
}

const WorkItemDialog: React.FC<WorkItemDialogProps> = React.memo(
  ({ intent, plan, submitting, error, onCreate, onUpdate, onClose }) => (
    <Dialog
      open={intent !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        {intent === null ? null : (
          <WorkItemForm
            key={intent.kind === 'edit' ? `edit:${intent.item.id}` : `create:${intent.stage ?? ''}`}
            intent={intent}
            plan={plan}
            submitting={submitting}
            error={error}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  ),
);
WorkItemDialog.displayName = 'WorkItemDialog';

export default WorkItemDialog;
