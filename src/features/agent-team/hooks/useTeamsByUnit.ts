import { useMemo } from 'react';

import type { TeamSummary } from '@/shared/types/team';

import { useTeamListStore } from '../store/teamListStore';
import { teamsByUnit } from '../utils/teamList';

/**
 * 按单元分组的团队表（`workspaceKey → 团队列表`）。
 *
 * 三个侧栏变体（本地项目树 / 工作树列表 / WSL·SSH 连接卡）都要回答同一件事：
 * 「这个单元下有没有团队行」。分组口径只有 `teamsByUnit` 一处实现，与 `useSessionsByUnit`
 * 完全同形 —— 两处都按单元 key 的**相等比较**分组，不各扫一遍、也不各写一套归属判据。
 *
 * # 数据来源
 *
 * `teamListStore.list`（`team_list(null)`，全部项目）。侧栏是常驻的，所以它读的是**全量**
 * 清单并在消费侧按单元裁开；用「激活项目」顶替会把别的项目的团队凭空藏起来。
 *
 * 侧栏**不**读 `truncated`：超过后台上界（50 行）时少显示几行是有界退化，"看全部团队"的
 * 地方是团队面板（它读同一份清单）。
 *
 * # 订阅成本
 *
 * 只订阅 `list` 一片（清单只在拉到新结果时替换），因此侧栏各行的 memo 在团队快照脉冲
 * （别的事件）下不失效。`useMemo` 的依赖是清单引用本身：同一份清单下所有订阅者拿到同一个
 * `Map`，行组件才真的不重画。
 */
export function useTeamsByUnit(): Map<string, TeamSummary[]> {
  const list = useTeamListStore((s) => s.list);
  return useMemo(() => teamsByUnit(list?.teams ?? []), [list]);
}
