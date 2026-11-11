import { useCallback, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import type { WorkItemCreateDraft, WorkItemDialogIntent } from '../components/WorkItemForm';
import type { UpdateWorkItemParams, WorkItem } from '../types';
import type { TaskItem } from '../viewModel';

import type { ShowToast } from './useRunSingleWorkItem';

/**
 * 新建 / 编辑对话框的**开关 + 提交 + 错误回填**（design §11.2 / §11.3）。
 *
 * # 为什么是一份 hook，而不是 `TasksPanel` 里的五个 `useState`
 *
 * 这五个状态的生命周期**完全同生同灭**：`intent`（开没开、开哪一档）决定另外四个是否存在
 * （`submitting` / `dialogError` 只在打开时有意义；`close()` 一次清两个）。把它们摊在编排层里
 * 会得到「哪个 setState 该在哪清」的记忆负担 —— 而漏清一处就是「上次的报错留到下一次打开」。
 *
 * # 失败时**不关**对话框
 *
 * 用户刚填的内容还在里面，关掉等于让他重填一遍。所以失败只把错误回填（`dialogError`），
 * 由表单在对话框内渲染。
 *
 * # 成功时**关**对话框 + toast
 *
 * 与失败相反：保存成功了就没有「里面还有内容」这件事。`onCreated` 只对**本面板发起的**
 * create 生效（宿主传 `revealRow`）—— 列表因别的原因多出一行（延迟提交的删除失败把行放回来）
 * 时不该滚（design §11.7）。
 */
export interface WorkItemDialogSubmitDeps {
  actions: {
    create: (params: WorkItemCreateDraft & { projectId: string }) => Promise<WorkItem>;
    update: (params: UpdateWorkItemParams) => Promise<unknown>;
  };
  /** `null` = 没有激活项目：create 不发（对话框不该在无项目时打开）。 */
  projectId: string | null;
  showToast: ShowToast;
  /** create 成功后把新行滚进视野（见 `useRevealRow`）。 */
  onCreated: (id: string) => void;
}

export interface WorkItemDialogSubmit {
  /** `null` = 对话框关闭。 */
  intent: WorkItemDialogIntent | null;
  submitting: boolean;
  /** 提交失败的原文（表单在对话框内渲染）。 */
  error: string | null;
  /** 打开「新建」；`stage` 是列底部 `+ Add` 的预填值。 */
  openCreate: (stage?: string) => void;
  /** 打开「编辑」；`item === null` 时什么都不做（没有选中项就没有可编辑的东西）。 */
  openEdit: (item: TaskItem | null) => void;
  close: () => void;
  create: (draft: WorkItemCreateDraft) => void;
  update: (params: UpdateWorkItemParams) => void;
}

export function useWorkItemDialogSubmit({
  actions,
  projectId,
  showToast,
  onCreated,
}: WorkItemDialogSubmitDeps): WorkItemDialogSubmit {
  const [intent, setIntent] = useState<WorkItemDialogIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback((stage?: string) => {
    setError(null);
    setIntent({ kind: 'create', stage });
  }, []);

  const openEdit = useCallback((item: TaskItem | null) => {
    if (item === null) return;
    setError(null);
    setIntent({ kind: 'edit', item });
  }, []);

  /** 关闭时**一并清**错误：下次打开是全新的一次填写，不该带着上一次的失败。 */
  const close = useCallback(() => {
    setIntent(null);
    setError(null);
  }, []);

  const create = useCallback(
    (draft: WorkItemCreateDraft) => {
      if (projectId === null) return;
      setSubmitting(true);
      setError(null);
      actions.create({ ...draft, projectId }).then(
        (created) => {
          setSubmitting(false);
          setIntent(null);
          showToast('Work item created');
          onCreated(created.id);
        },
        (err: unknown) => {
          setSubmitting(false);
          setError(invokeErrorMessage(err, 'Failed to create work item'));
        },
      );
    },
    [actions, projectId, showToast, onCreated],
  );

  const update = useCallback(
    (params: UpdateWorkItemParams) => {
      setSubmitting(true);
      setError(null);
      actions.update(params).then(
        () => {
          setSubmitting(false);
          setIntent(null);
          showToast('Work item saved');
        },
        (err: unknown) => {
          setSubmitting(false);
          setError(invokeErrorMessage(err, 'Failed to save work item'));
        },
      );
    },
    [actions, showToast],
  );

  return { intent, submitting, error, openCreate, openEdit, close, create, update };
}
