import React, { useCallback, useState } from 'react';

import { Button } from '@/ui/Button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/Dialog';
import { Input, Textarea } from '@/ui/Input';

import type {
  CreateWorkItemParams,
  StagePlan,
  UpdateWorkItemParams,
  WorkItem,
  WorkItemPriority,
} from '../types';

/**
 * 新建 / 编辑工作项的表单体（design §11.2 / §11.3 共用）。
 *
 * # 为什么新建与编辑共用一个表单
 *
 * 两者的字段**逐行同构**（标题、描述、优先级、标签、负责人），差别只有两处：
 *
 * | 差别 | 新建 | 编辑 |
 * | --- | --- | --- |
 * | stage | 有一个下拉（由列底部 `+ Add` 预填） | **没有**控件 —— 改阶段只能走 StageRail |
 * | 提交载荷 | `CreateWorkItemParams`（无 `id`） | `UpdateWorkItemParams`（带 `id`，没有 `stage`） |
 *
 * 第二行是契约层面的：`UpdateWorkItemParams` 里没有 `stage`（后端只允许经 `transition` 改阶段），
 * 所以编辑态**不能**出现 stage 选择器 —— 出现一个改不动的控件比没有更糟。
 *
 * # 清空语义（跨端契约，见 `types.ts` 的 `UpdateWorkItemParams`）
 *
 * 编辑态一律提交**当前全部字段**，清空用空值表达：`priority: ''` / `assignee: ''` / `labels: []`。
 * 只提交「改过的字段」会让「把优先级清空」无法表达（`undefined` = 不改），用户会看到保存成功
 * 但优先级没变。新建态没有清空语义，空值一律落成 `undefined`（让后端用默认值）。
 *
 * # 本地状态为什么不随 `intent` 变化重置
 *
 * 表单状态只在**打开的那一刻**从 intent 初始化，之后归用户。实现上靠「关闭即卸载」：宿主
 * （[`WorkItemDialog`](./WorkItemDialog.tsx)）在 `intent === null` 时不渲染本组件，再次打开是
 * 新挂载（`useState` 初值重新取）。用 `useEffect` 同步 intent 会在「用户已改了三格、父组件
 * 重渲染」时把输入打回原值。
 *
 * `intent` / 新建载荷两个类型住在**本文件**：唯一解释它们的消费者是这个表单（宿主只负责
 * 转交），放这里就不需要「类型文件 → 两个组件」的第三条导入边。
 */
export type WorkItemDialogIntent =
  | { kind: 'create'; stage?: string }
  | { kind: 'edit'; item: WorkItem };

/** 新建载荷去掉 `projectId`：表单不认识项目（项目由宿主注入）。 */
export type WorkItemCreateDraft = Omit<CreateWorkItemParams, 'projectId'>;

const PRIORITY_OPTIONS: WorkItemPriority[] = ['p0', 'p1', 'p2', 'p3'];

const FIELD_LABEL_CLASS = 'text-micro font-medium text-text-secondary';

const SELECT_CLASS =
  'h-7 w-full rounded-md border border-border bg-bg-primary px-2 text-[0.82em] text-text-primary focus:border-accent-blue focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none';

/** 逗号分隔（中英文都认）→ 去空、去重；`[]` 在 `update` 里表示**清空**。 */
function parseLabels(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,，]/)) {
    const label = part.trim();
    if (label !== '') seen.add(label);
  }
  return [...seen];
}

interface WorkItemFormProps {
  intent: WorkItemDialogIntent;
  plan: StagePlan | null;
  submitting: boolean;
  /** 提交失败的原文（宿主捕获后回传；成功后对话框会被关掉）。 */
  error: string | null;
  onCreate: (draft: WorkItemCreateDraft) => void;
  onUpdate: (params: UpdateWorkItemParams) => void;
  onClose: () => void;
}

const WorkItemForm: React.FC<WorkItemFormProps> = ({
  intent,
  plan,
  submitting,
  error,
  onCreate,
  onUpdate,
  onClose,
}) => {
  const editing = intent.kind === 'edit' ? intent.item : null;

  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [stage, setStage] = useState(
    intent.kind === 'create' ? (intent.stage ?? plan?.stages[0] ?? '') : '',
  );
  const [priority, setPriority] = useState<WorkItemPriority | ''>(editing?.priority ?? '');
  const [labelsText, setLabelsText] = useState((editing?.labels ?? []).join(', '));
  const [assignee, setAssignee] = useState(editing?.assignee ?? '');
  /** 就地校验（标题必填）：只挡住提交，不弹 toast —— 输入框旁边才是用户正在看的地方。 */
  const [titleError, setTitleError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedTitle = title.trim();
      if (trimmedTitle === '') {
        setTitleError('标题不能为空');
        return;
      }
      setTitleError(null);

      const labels = parseLabels(labelsText);
      if (intent.kind === 'create') {
        // 新建没有「清空」语义：空值落成 `undefined`，由后端补默认值。
        onCreate({
          title: trimmedTitle,
          body,
          stage: stage === '' ? undefined : stage,
          priority: priority === '' ? undefined : priority,
          labels,
          assignee: assignee.trim() === '' ? undefined : assignee.trim(),
        });
        return;
      }
      onUpdate({
        id: intent.item.id,
        title: trimmedTitle,
        body,
        // `''` = 清空（`undefined` = 不改，那就无法表达「把优先级清掉」）。
        priority,
        labels,
        assignee: assignee.trim(),
      });
    },
    [assignee, body, intent, labelsText, onCreate, onUpdate, priority, stage, title],
  );

  const creating = intent.kind === 'create';
  const submitLabel = creating ? '创建' : '保存';

  return (
    <form onSubmit={handleSubmit} aria-label={creating ? '新建工作项' : '编辑工作项'}>
      <DialogHeader>
        <DialogTitle>{creating ? '新建工作项' : '编辑工作项'}</DialogTitle>
        <DialogDescription>
          {creating
            ? '工作项保存在本机（Local provider）。'
            : '改阶段请用详情里的阶段轨道 —— 那是一次流转，不是一次改名。'}
        </DialogDescription>
      </DialogHeader>

      {error === null ? null : (
        <p role="alert" className="mb-2 text-micro break-words text-accent-red">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="work-item-title" className={FIELD_LABEL_CLASS}>
            标题
          </label>
          <Input
            id="work-item-title"
            value={title}
            size="sm"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：修复登录态过期"
          />
          {titleError === null ? null : (
            <p role="alert" className="text-micro text-accent-red">
              {titleError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="work-item-body" className={FIELD_LABEL_CLASS}>
            描述
          </label>
          <Textarea
            id="work-item-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="可选"
            className="min-h-[64px] py-1 text-[0.82em]"
          />
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {/* stage 选择器**只在新建时**出现：编辑态没有 `stage` 契约（见文件头表格）。
              阶段轨还没拿到时不画（空下拉会让人以为「阶段集是空的」），由后端补默认阶段。 */}
          {creating && plan !== null ? (
            <div className="flex min-w-[120px] flex-1 flex-col gap-1">
              <label htmlFor="work-item-stage" className={FIELD_LABEL_CLASS}>
                阶段
              </label>
              <select
                id="work-item-stage"
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                className={SELECT_CLASS}
              >
                {plan.stages.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex min-w-[100px] flex-1 flex-col gap-1">
            <label htmlFor="work-item-priority" className={FIELD_LABEL_CLASS}>
              优先级
            </label>
            <select
              id="work-item-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as WorkItemPriority | '')}
              className={SELECT_CLASS}
            >
              <option value="">未设置</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="work-item-labels" className={FIELD_LABEL_CLASS}>
            标签（逗号分隔）
          </label>
          <Input
            id="work-item-labels"
            value={labelsText}
            size="sm"
            onChange={(event) => setLabelsText(event.target.value)}
            placeholder="bug, ui"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="work-item-assignee" className={FIELD_LABEL_CLASS}>
            负责人
          </label>
          <Input
            id="work-item-assignee"
            value={assignee}
            size="sm"
            onChange={(event) => setAssignee(event.target.value)}
            placeholder="可选"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? '提交中…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
};

export default WorkItemForm;
