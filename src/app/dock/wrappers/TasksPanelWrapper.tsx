import React from 'react';

import { TasksPanel } from '@/features/work-items';
import { useProjectStore } from '@/shared/store/projectStore';

/**
 * Tasks dock 面板的适配层：把**激活项目**与 PR 的仓库展示标签注入面板。
 *
 * 面板（{@link TasksPanel}）不认识 `useProjectStore` —— 它只收 `projectId` 与 `repoLabel`。
 * 这样它就能在测试里被单独渲染（给 `null` 即空态），也不会因为「项目 store 里还存着别的项目」
 * 而渲染出别人的工作项。
 *
 * 与 `TeamPanelWrapper` 的形状一致：wrapper 只做跨域连线（那边连 toast 与终端，这里只有项目）；
 * **不传 store** —— store 是域内实现，跨域直引只能走 `@/features/work-items/store/...`
 * 这类公开路径，而面板自己已经拿到了它需要的那一份。
 *
 * # `repoLabel` 用项目名，不额外求一次仓库名
 *
 * `PRListItem` 里只有 `headRepositoryOwner`（fork 时是别人的 owner），拿不到 `owner/name`；
 * 现有任何一条 IPC 也不返回仓库名。为一个**展示标签**新开一次远端请求不划算，而项目名在
 * 绝大多数情况下就是 clone 出来的目录名（= 仓库名）。它只出现在 PR 卡片的 `#128` 前面，
 * 标错了也不会改变任何行为。
 */
/**
 * Tasks dock 面板的适配层：把**激活项目**与 PR 的仓库展示标签注入面板。
 *
 * 面板（{@link TasksPanel}）不认识 `useProjectStore` —— 它只收 `projectId` 与 `repoLabel`。
 * 这样它就能在测试里被单独渲染（给 `null` 即空态），也不会因为「项目 store 里还存着别的项目」
 * 而渲染出别人的工作项。
 *
 * 与 `TeamPanelWrapper` 的形状一致：wrapper 只做跨域连线（那边连 toast 与终端，这里只有项目）；
 * **不传 store** —— store 是域内实现，跨域直引只能走 `@/features/work-items/store/...`
 * 这类公开路径，而面板自己已经拿到了它需要的那一份。
 *
 * # `repoLabel` 用项目名，不额外求一次仓库名
 *
 * `PRListItem` 里只有 `headRepositoryOwner`（fork 时是别人的 owner），拿不到 `owner/name`；
 * 现有任何一条 IPC 也不返回仓库名。为一个**展示标签**新开一次远端请求不划算，而项目名在
 * 99% 的仓库里就是目录名（= 仓库名，Windows/macOS 上都按这个习惯 get clone）。它只出现在
 * PRP卡片的 `#128` 前面，标错了也不会改变任何行为。
 */
const TasksPanelWrapper: React.FC = React.memo(() => {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const repoLabel = useProjectStore((s) => s.activeProject?.name ?? '');
  return <TasksPanel projectId={projectId} repoLabel={repoLabel} />;
});
TasksPanelWrapper.displayName = 'TasksPanelWrapper';

export default TasksPanelWrapper;
export { TasksPanelWrapper };
