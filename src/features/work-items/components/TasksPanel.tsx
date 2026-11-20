import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useToast } from '@/shared/hooks/useToast';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { Island } from '@/ui/Island';

import { usePanelShortcuts } from '../hooks/usePanelShortcuts';
import { useRevealRow } from '../hooks/useRevealRow';
import { useStagePlan } from '../hooks/useStagePlan';
import { useTaskFeed } from '../hooks/useTaskFeed';
import { useWorkItemDelete } from '../hooks/useWorkItemDelete';
import { useWorkItemDialogSubmit } from '../hooks/useWorkItemDialogSubmit';
import { GITHUB_PR_PROVIDER_LABEL } from '../providers/githubPr';
import { filterWorkItems } from '../utils/filterWorkItems';
import {
  localStorageOrNull,
  readViewPreference,
  writeViewPreference,
} from '../utils/viewPreference';

import TasksPanelBody from './TasksPanelBody';
import TasksPanelHeader, { type TaskView } from './TasksPanelHeader';
import TasksPanelStatus from './TasksPanelStatus';
import UndoBar from './UndoBar';
import WorkItemDetailPane from './WorkItemDetailPane';
import WorkItemDialog from './WorkItemDialog';

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
 * | 详情岛的接线（选中项 + 阶段轨 + 四个动作） | `components/WorkItemDetailPane` |
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

  /**
   * 新建 / 编辑对话框的开关与提交（规则见 `useWorkItemDialogSubmit` 的文件头）。
   *
   * `onCreated` 传 `revealRow`：只有**本面板发起的** create 会滚动（design §11.7）。
   */
  const dialog = useWorkItemDialogSubmit({
    actions,
    projectId,
    showToast,
    onCreated: revealRow,
  });

  /** 选中项由 `selectedId` **派生**：被删的行从列表消失时它自然是 `null`。 */
  const selected = useMemo(
    () => (selectedId === null ? null : (items.find((row) => row.id === selectedId) ?? null)),
    [items, selectedId],
  );

  /** 搜索过滤的判据住在 `utils/filterWorkItems`（纯函数，边界由它的单测钉住）。 */
  const visible = useMemo(() => filterWorkItems(items, search), [items, search]);

  const handleNew = useCallback(() => dialog.openCreate(plan?.stages[0]), [dialog, plan]);

  const handleOpen = useCallback((id: string) => setSelectedId(id), []);

  const handleCloseDetail = useCallback(() => setSelectedId(null), []);

  const handleEdit = useCallback(() => dialog.openEdit(selected), [dialog, selected]);

  const handleMove = useCallback(
    (id: string, to: string) => {
      // store 已做乐观更新与失败回滚，但它**不写** `errors`（没有调用方可以替它提示），
      // 所以提示落在这里：回滚发生了，用户必须知道卡片为什么又跳回原列。
      actions.transition(id, to).catch((err: unknown) => {
        showToast(`Transition failed: ${invokeErrorMessage(err, 'Unknown error')}`, 'error');
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
    { dialogOpen: dialog.intent !== null, hasSelection: selected !== null },
    { onCreate: handleNew, onDelete: handleDelete, onClose: handleCloseDetail },
  );

  return (
    // 快捷键只在**焦点位于面板内部**时生效：监听器挂在根元素上而不是 `document` 上，
    // 所以终端里的 `Cmd+N` 不会被这里抢走（理由见 `usePanelShortcuts`）。
    //
    // 这是**加速器**而非唯一入口（新建 / 删除 / 关闭都有可见按钮），且面板本身不是 widget ——
    // 给它 `role` 反而会向读屏逐报一个并不存在的交互组件，所以只给事件、不给角色。
    //
    // # 几何全部由中心区容器给（`AppCenter` 的 `CENTER_WRAPPER_CLASS`）
    //
    // 这里**不写**背景 / 内缩 / 圆角 / 高度 —— 那些是中心框架的职责，写在这里就会与
    // 其它中心视图对不齐（本面板曾经自写 `rounded-lg bg-bg-primary p-1.5`，四周比
    // ProjectView / Library / Settings 各多缩 6px）。
    //
    // 本组件只负责**往里填空**：一座主岛（头部 + 内容都在岛内）。
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 容器被委派的快捷键（同上）
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={handleShortcut}>
      <Island data-testid="tasks-main-island" className="flex-1">
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
            github.error === null ? null : `${GITHUB_PR_PROVIDER_LABEL} PR: ${github.error}`
          }
          onRetryProvider={github.refresh}
          toast={toast}
        />

        {/*
        内容区**不自己滚动**：两个视图各自滚动（看板列 / 列表 / 详情岛）。
        在分栏外面再包一层 `overflow-auto` 等于两块又变回一整个长文档（`component-guidelines.md`）。
      */}
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
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
            onNew={handleNew}
            // 没有选中项就传 `null`：分栏据此不渲染第二块（否则会留一条能拖的空缝）。
            detail={
              selected === null ? null : (
                <WorkItemDetailPane
                  item={selected}
                  plan={plan}
                  projectId={projectId}
                  showToast={showToast}
                  onMove={handleDetailMove}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onClose={handleCloseDetail}
                />
              )
            }
          />
        </div>

        {pendingTitle === null ? null : (
          <UndoBar title={pendingTitle} onUndo={undoDelete} onExpire={dismissUndo} />
        )}
      </Island>

      <WorkItemDialog
        intent={dialog.intent}
        plan={plan}
        submitting={dialog.submitting}
        error={dialog.error}
        onCreate={dialog.create}
        onUpdate={dialog.update}
        onClose={dialog.close}
      />
    </div>
  );
});
TasksPanel.displayName = 'TasksPanel';

export default TasksPanel;
