import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useToast } from '@/shared/hooks/useToast';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { usePanelShortcuts } from '../hooks/usePanelShortcuts';
import { useRevealRow } from '../hooks/useRevealRow';
import { useStagePlan } from '../hooks/useStagePlan';
import { useWorkItems } from '../hooks/useWorkItems';
import { useWorkItemsStore } from '../store/workItemsStore';
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
 * Tasks 面板（Local provider，design §4.2）：Board / List 双视图 + 详情 + 新建/编辑 + 撤销条。
 *
 * # 失败通道分两处，不能合并
 *
 * | 来源 | 谁渲染 |
 * | --- | --- |
 * | 读路径（`load` / 5 秒后延迟提交的删除）→ `store.errors` | 顶部错误横幅 + 重试 |
 * | 动作（`create` / `update` / `transition`）→ Promise 抛出 | 对话框内联 / toast |
 *
 * `transition` 的失败**不写** `errors`（见 `store/workItemsStore.ts` 的通道表），所以必须在
 * 调用点 catch 并 toast；不 catch 就是「卡片悄悄弹回原列，一个字都不说」。
 *
 * # 撤销只有一条通道
 *
 * 删除后的 5 秒窗口由 [`UndoBar`] 独占（shared toast 是 3 秒且无动作按钮，两套计时器必然漂移）。
 * 撤销以 `undoDelete()` 的**返回值**结算：`false` = 窗口已过 → 直接收起，**不**提示成功。
 *
 * 「撤的是该项目最近一次删除」是已知取舍：同时删两行时后进覆盖先前的窗口（store 的 Map 保插入序），
 * 但先删的那行仍会在 5 秒后正常提交删除 —— 这里只展示一个窗口，不为它改契约。
 *
 * # 顺序不动、不做入场动画
 *
 * `items` 的顺序是 `updatedAt DESC`（store 与后端同一契约）：本面板不排序、不插入动画。
 * 唯一会滚动的情况是**本面板发起的 create**（`useRevealRow`）—— 延迟提交失败的删除会让那一行
 * **自己回到列表**，把回魂当新建滚动过去就是谎报事实。
 *
 * # 状态的归属
 *
 * 搜索 / 选中 / 对话框 / 撤销条都是**这一次挂载**的导航与呈现状态，留在本组件的
 * `useState` 里；数据面（列表 / 阶段轨）来自 store 与 hook。选中项由 `selectedId` 派生，所以
 * 「删掉的那条正好是打开着的」不需要任何同步代码：它从列表消失，详情自然关掉。
 *
 * **视图是例外**：`board` / `list` 是这台机器的呈现偏好，挂载期状态会让每次重开面板都回到
 * Board（design §4.5 要求「记忆用户上次选择」），所以它经 `utils/viewPreference` 落到
 * `localStorage`。
 */
interface TasksPanelProps {
  /** 宿主注入的激活项目（`null` = 没有激活项目，面板显示空态且不发 IPC）。 */
  projectId: string | null;
}

/** 撤销条的内容：被删标题（文案要点名，5 秒窗口里这是唯一的核对依据）。 */
interface PendingUndo {
  title: string;
}

const TasksPanel: React.FC<TasksPanelProps> = React.memo(({ projectId }) => {
  const { items, loading, error, actions } = useWorkItems(projectId);
  const { plan, loading: planLoading } = useStagePlan();
  const { toast, showToast } = useToast();

  // 视图的初值来自持久化的偏好（读不到 / 存储不可用时 `viewPreference` 自己回落 `board`）。
  const [view, setView] = useState<TaskView>(() => readViewPreference(localStorageOrNull()));
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intent, setIntent] = useState<WorkItemDialogIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

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

  const handleRefresh = useCallback(() => {
    if (projectId === null) return;
    // 手动刷新走 store 的 `load`（同项目在飞会被复用，连点不会打两次 IPC）。
    void useWorkItemsStore.getState().load(projectId);
  }, [projectId]);

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
    setSelectedId(null);
    actions.remove(item.id).then(
      () => setPendingUndo({ title: item.title }),
      (err: unknown) => showToast(invokeErrorMessage(err, '删除工作项失败'), 'error'),
    );
  }, [actions, selected, showToast]);

  const handleUndo = useCallback(() => {
    // 以返回值为准：`false` = 窗口已过（那次删除已经真的提交了）→ 收起，且**不**提示成功。
    const restored = actions.undo();
    setPendingUndo(null);
    if (restored) showToast('已恢复工作项');
  }, [actions, showToast]);

  const handleUndoExpire = useCallback(() => setPendingUndo(null), []);

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
        onRefresh={handleRefresh}
        onNew={handleNew}
      />

      <TasksPanelStatus error={error} onRetry={handleRefresh} toast={toast} />

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

      {pendingUndo === null ? null : (
        <UndoBar title={pendingUndo.title} onUndo={handleUndo} onExpire={handleUndoExpire} />
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
