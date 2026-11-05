import type { TaskItem } from '../viewModel';

/**
 * 搜索过滤（design §4.5 的搜索框）：标题 / 标签 / 负责人，大小写不敏感。
 *
 * # 为什么抽成纯函数
 *
 * 它是一条**判据**（「命中」的定义），而 `TasksPanel` 是编排层 —— 判据留在组件里就只能靠
 * 渲染断言间接测（造三行数据、看剩下几行）。抽出来后它的边界（空查询 / 空白查询 / 多标签
 * 命中 / 未指派）可以直接断言，组件侧只剩「调用它」。
 *
 * # 空查询返回**原数组引用**，不是 `items.filter(...)`
 *
 * 这决定了 `visible` 的 `useMemo` 依赖是否稳定：返回新数组会让每次重渲染都产出新引用，
 * 下游（BoardView / ListView 的 `memo`）白掉。空查询就是「不过滤」，那就该原样返回。
 *
 * # 空白查询等价于空查询
 *
 * `search.trim()` 先归一：用户打了几个空格不该让列表变成「没有匹配」（那看起来像数据丢了）。
 */
export function filterWorkItems(items: TaskItem[], search: string): TaskItem[] {
  const query = search.trim().toLowerCase();
  if (query === '') return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(query) ||
      item.labels.some((label) => label.toLowerCase().includes(query)) ||
      (item.assignee ?? '').toLowerCase().includes(query),
  );
}
