import React from 'react';

import { cn } from '@/lib/utils';

import { GITHUB_PR_PROVIDER_LABEL } from '../providers/githubPr';
import type { TaskSource } from '../viewModel';

/**
 * 卡片 / 列表行 / 详情上的**来源徽标**（design §4.3 的 `[provider badge]` 位）。
 *
 * # 文字是主信息，颜色只是辅助
 *
 * 「这条来自哪里」不能只用颜色表达：色盲用户、亮色主题下的低对比、截图转灰度 —— 三条路都会
 * 把「蓝色 = GitHub」变成「看不出 = GitHub」。所以两档都渲染**可读的词**，`data-task-source`
 * 供测试与选择器定位，颜色只是让扫视更快一点（两档共用同一套 `border-border*` token，
 * 不引入新的语义色：来源不是严重度，不需要红黄绿）。
 *
 * # 为什么 `Local` 也要画
 *
 * 只在 GitHub 卡片上贴徽标，会让「没有徽标」这个状态本身变成第二个含义（= local），
 * 于是加第三个 provider 时所有旧卡片都需要改判据。两档都画，`Record<TaskSource, …>` 保证
 * 新增来源时**编译失败**（漏一档就没人能渲染它），而不是悄悄渲染成空白。
 */
const SOURCE_LABEL: Record<TaskSource, string> = {
  local: 'Local',
  // provider 的自称来自它自己的模块：改名字只改一处（design §3.2 的 `WorkItemProvider.name`）。
  github: GITHUB_PR_PROVIDER_LABEL,
};

/** 两档的样式差 = 描边有无（语义色留给 stage / 优先级，来源不抢那个色板）。 */
const SOURCE_CLASS: Record<TaskSource, string> = {
  local: 'border-border-subtle text-text-muted',
  github: 'border-border text-text-secondary',
};

interface TaskSourceBadgeProps {
  source: TaskSource;
}

const TaskSourceBadge: React.FC<TaskSourceBadgeProps> = React.memo(({ source }) => (
  <span
    data-task-source={source}
    title={`来源：${SOURCE_LABEL[source]}`}
    className={cn(
      'inline-flex shrink-0 items-center rounded border px-1 py-0.5 text-micro leading-none',
      SOURCE_CLASS[source],
    )}
  >
    {SOURCE_LABEL[source]}
  </span>
));
TaskSourceBadge.displayName = 'TaskSourceBadge';

export default TaskSourceBadge;
