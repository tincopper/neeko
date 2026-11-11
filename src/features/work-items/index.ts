/**
 * Work Items 域的公开面（**只有组件**）。
 *
 * store / hook / api **不**在这里 re-export：zustand store 是域的公开状态接口，消费方按约定
 * 直导 `@/features/work-items/store/workItemsStore`（与 `src/AGENTS.md` 的导入防火墙一致）。
 * 本门面存在的唯一理由是「dock 面板不跨域拿内部组件」—— 它只需要知道有个 `TasksPanel`。
 *
 * 命名：产品文案是 **Tasks**，代码域是 `WorkItem`（design §2.1）。所以门面导出的是
 * `TasksPanel`（对外的面板名）而不是 `WorkItemPanel`（它一台面板里装的是工作项）。
 */
export { default as TasksPanel } from './components/TasksPanel';
