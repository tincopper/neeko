import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useToast } from '@/shared/hooks/useToast';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { usePanelShortcuts } from '../hooks/usePanelShortcuts';
import { useRevealRow } from '../hooks/useRevealRow';
import { useStagePlan } from '../hooks/useStagePlan';
import { useTaskFeed } from '../hooks/useTaskFeed';
import { useWorkItemDelete } from '../hooks/useWorkItemDelete';
import { GITHUB_PR_PROVIDER_LABEL } from '../providers/githubPr';
import type { UpdateWorkItemParams } from '../types';
import {
  localStorageOrNull,
  readViewPreference,
  writeViewPreference,
} from '../utils/viewPreference';

import TasksPanelBody from './TasksPanelBody';
import TasksPanelHeader, { type TaskView } from './TasksPanelHeader';
import TasksPanelStatus from './TasksPanelStatus';
import UndoBar from './UndoBar';
import WorkItemDetail from './WorkItemDetail';
import WorkItemDialog from './WorkItemDialog';
import type { WorkItemCreateDraft, WorkItemDialogIntent } from './WorkItemForm';

/**
 * Tasks 面板（design §4.2）：Board / List 双视图 + 详情 + 新建/编辑 + 撤销条。
 *
 * # 本文件只做「编排」
 *
 * | 规则 | 住在哪里 |
 * | --- | --- |
 * | 三条错误通道的分工（本地读 / provider 读 / 动作） | `components/TasksPanelStatus` |
 * | 两档来源合并成一份 `items`（不跨 provider 重排、不重排我自己的顺序） | `hooks/useTaskFeed` |
 * | 5 秒撤销窗口（以 `undoDelete()` 的返回值为准，不拿条子的计时器当判据） | `hooks/useWorkItemDelete` |
 * | 视图 / provider 开关的持久化与容错 | `utils/viewPreference` / `utils/providerPreference` |
 *
 * 留下的是「这次挂载」的状态（搜索 / 选中 / 对话框）与把动作接到对应 hook 的胶水。选中项由
 * `selectedId` **派生**：被删的行从列表消失时详情自然关掉，不需要任何同步代码。
 *
 * # `transition` 的失败必须在这里 catch
 *
 * store 对 `transition` 做乐观更新 + 失败回滚，但它**不写** `errors`（没有调用方可以替它提示），
 * 所以提示落在调用点。不 catch 就是「卡片悄悄弹回原列，一个字都不说」。
 *
 * # 视图是唯一不留在挂载期的状态
 *
 * `board` / `list` 与 `githubProvider` 是这台机器的偏好：挂载期状态会让每次重开面板都回到
 * Board / 关掉 PR（design §4.5、§8.3），所以它们各有一份 localStorage 落点。
 */
interface TasksPanelProps {
  /** 宿主注入的激活项目（`null` = 没有激活项目，面板显示空态且不发 IPC）。 */
  projectId: string | null;
  /**
   * PR 的仓库展示标签（`owner/name`；拿不到时留空）。
   *
   * 由宿主注入而不是面板自己查：`PRListItem` 里只有 `headRepositoryOwner`（fork 时是别人的
   * owner），仓库名不在任何一条现有 IPC 的返回里 —— 不为了一个展示标签新增一次请求。
   */
  repoLabel?: string;
}

const TasksPanel: React.FC<TasksPanelProps> = React.memo(({ projectId, repoLabel = '' }) => {
  const {
    items,
    loading,
    error,
    actions,
    refresh: refreshFeed,
    github,
  } = useTaskFeed(projectId, repoLabel);
  const { plan, loading: planLoading } = useStagePlan();
  const { toast, showToast } = useToast();

  // 视图的初值来自持久化的偏好（读不到 / 存储不可用时 `viewPreference` 自己回落 `board`）。
  const [view, setView] = useState<TaskView>(() => readViewPreference(localStorageOrNull()));
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intent, setIntent] = useState<WorkItemDialogIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** 删除 + 撤销窗口（规则见 `useWorkItemDelete` 的文件头）。 */
  const {
    pendingTitle,
    remove: removeItem,
    undo: undoDelete,
    dismiss: dismissUndo,
  } = useWorkItemDelete(actions, showToast);

  /** 卡片 / 行的容器："创建后滚到新卡片" 在这棵子树里找目标（见 `useRevealRow`）。 */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const revealRow = useRevealRow(bodyRef);

  /** 选中项由 `selectedId` **派生**：被删的行从列表消失时它自然是 `null`。 */
  const selected = useMemo(
    () => (selectedId === null ? null : (items.find((row) => row.id === selectedId) ?? null)),
    [items, selectedId],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.labels.some((label) => label.toLowerCase().includes(query)) ||
        (item.assignee ?? '').toLowerCase().includes(query),
    );
  }, [items, search]);

  const handleNew = useCallback(() => {
    setDialogError(null);
    setIntent({ kind: 'create', stage: plan?.stages[0] });
  }, [plan]);

  const handleAddToStage = useCallback((stage: string) => {
    setDialogError(null);
    setIntent({ kind: 'create', stage });
  }, []);

  const handleOpen = useCallback((id: string) => setSelectedId(id), []);

  const handleCloseDetail = useCallback(() => setSelectedId(null), []);

  const handleEdit = useCallback(() => {
    if (selected === null) return;
    setDialogError(null);
    setIntent({ kind: 'edit', item: selected });
  }, [selected]);

  const handleCloseDialog = useCallback(() => {
    setIntent(null);
    setDialogError(null);
  }, []);

  const handleCreate = useCallback(
    (draft: WorkItemCreateDraft) => {
      if (projectId === null) return;
      setSubmitting(true);
      setDialogError(null);
      actions.create({ ...draft, projectId }).then(
        (created) => {
          setSubmitting(false);
          setIntent(null);
          showToast('已创建工作项');
          // 只对**本面板发起的** create 滚动（design §11.7）：列表的其它变化不滚，
          // 尤其是 5 秒后提交失败的删除把行放回来的那一次（那不是新建）。
          revealRow(created.id);
        },
        (err: unknown) => {
          // 失败**不关**对话框：用户刚填的内容还在里面，关掉等于让他重填一遍。
          setSubmitting(false);
          setDialogError(invokeErrorMessage(err, '创建工作项失败'));
        },
      );
    },
    [actions, projectId, revealRow, showToast],
  );

  const handleUpdate = useCallback(
    (params: UpdateWorkItemParams) => {
      setSubmitting(true);
      setDialogError(null);
      actions.update(params).then(
        () => {
          setSubmitting(false);
          setIntent(null);
          showToast('已保存工作项');
        },
        (err: unknown) => {
          setSubmitting(false);
          setDialogError(invokeErrorMessage(err, '保存工作项失败'));
        },
      );
    },
    [actions, showToast],
  );

  const handleMove = useCallback(
    (id: string, to: string) => {
      // store 已做乐观更新与失败回滚，但它**不写** `errors`（没有调用方可以替它提示），
      // 所以提示落在这里：回滚发生了，用户必须知道卡片为什么又跳回原列。
      actions.transition(id, to).catch((err: unknown) => {
        showToast(`流转失败：${invokeErrorMessage(err, '未知错误')}`, 'error');
      });
    },
    [actions, showToast],
  );

  const handleDelete = useCallback(() => {
    const item = selected;
    if (item === null) return;
    // 先收起详情：删掉的那条从列表消失时详情自然关掉，不做第二次同步。
    setSelectedId(null);
    removeItem(item.id, item.title);
  }, [removeItem, selected]);

  const handleDetailMove = useCallback(
    (stage: string) => {
      if (selected === null) return;
      handleMove(selected.id, stage);
    },
    [handleMove, selected],
  );

  const handleSelectView = useCallback((next: TaskView) => {
    setView(next);
    // 写失败静默（隐私模式 / 配额）：一次偏好丢失不该让切视图报错（见 `viewPreference`）。
    writeViewPreference(localStorageOrNull(), next);
  }, []);

  const handleShortcut = usePanelShortcuts(
    { dialogOpen: intent !== null, hasSelection: selected !== null },
    { onCreate: handleNew, onDelete: handleDelete, onClose: handleCloseDetail },
  );

  return (
    // 快捷键只在**焦点位于面板内部**时生效：监听器挂在根元素上而不是 `document` 上，
    // 所以终端里的 `Cmd+N` 不会被这里抢走（理由见 `usePanelShortcuts`）。
    //
    // 这是**加速器**而非唯一入口（新建 / 删除 / 关闭都有可见按钮），且面板本身不是 widget ——
    // 给它 `role` 反而会向读屏逐报一个并不存在的交互组件，所以只给事件、不给角色。
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 容器被委派的快捷键（同上）
    <div className="relative flex h-full min-h-0 flex-col bg-bg-primary" onKeyDown={handleShortcut}>
      <TasksPanelHeader
        view={view}
        onSelectView={handleSelectView}
        search={search}
        onSearchChange={setSearch}
        onRefresh={refreshFeed}
        onNew={handleNew}
        githubEnabled={github.enabled}
        githubAvailability={github.availability}
        githubBlockedReason={github.blockedReason}
        onToggleGithub={github.setEnabled}
      />

      {/* provider 的错误自己带名字：横幅只有一句话，不点名就不知道是谁坏了。 */}
      <TasksPanelStatus
        error={error}
        onRetry={refreshFeed}
        providerError={
          github.error === null ? null : `${GITHUB_PR_PROVIDER_LABEL} PR：${github.error}`
        }
        onRetryProvider={github.refresh}
        toast={toast}
      />

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
        <TasksPanelBody
          projectId={projectId}
          loading={loading}
          error={error}
          items={items}
          visible={visible}
          view={view}
          plan={plan}
          planLoading={planLoading}
          onOpen={handleOpen}
          onMove={handleMove}
          onAdd={handleAddToStage}
          onNew={handleNew}
        />
      </div>

      {pendingTitle === null ? null : (
        <UndoBar title={pendingTitle} onUndo={undoDelete} onExpire={dismissUndo} />
      )}

      {selected === null ? null : (
        <WorkItemDetail
          item={selected}
          plan={plan}
          projectId={projectId}
          showToast={showToast}
          onMove={handleDetailMove}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={handleCloseDetail}
        />
      )}

      <WorkItemDialog
        intent={intent}
        plan={plan}
        submitting={submitting}
        error={dialogError}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onClose={handleCloseDialog}
      />
    </div>
  );
});
TasksPanel.displayName = 'TasksPanel';

export default TasksPanel;
