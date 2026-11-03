import React from 'react';

import { TasksPanel } from '@/features/work-items';
import { useProjectStore } from '@/shared/store/projectStore';

/**
 * Tasks dock 面板的适配层：唯一的职责是把**激活项目**注入面板。
 *
 * 面板（{@link TasksPanel}）不认识 `useProjectStore` —— 它只收一个
 * `projectId: string | null`。这样它就能在测试里被单独渲染（给 `null` 即空态），也不会因为
 * 「项目 store 里还存着别的项目」而渲染出别人的工作项。
 *
 * 与 `TeamPanelWrapper` 的形状一致：wrapper 只做跨域连线（那边连 toast 与终端，这里只有项目）；
 * **不传 store** —— store 是域内实现，跨域直引只能走 `@/features/work-items/store/...`
 * 这类公开路径，而面板自己已经拿到了它需要的那一份。
 */
const TasksPanelWrapper: React.FC = React.memo(() => {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return <TasksPanel projectId={projectId} />;
});
TasksPanelWrapper.displayName = 'TasksPanelWrapper';

export default TasksPanelWrapper;
export { TasksPanelWrapper };
