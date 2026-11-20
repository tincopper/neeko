import { useMemo } from 'react';

import type { TeamSummary } from '@/shared/types/team';

import { useTeamListStore } from '../store/teamListStore';
import { teamUnitKeys, teamsOfProject } from '../utils/teamList';

/**
 * 按项目分组的团队表（`projectId → 团队列表`）—— **项目层团队容器行**的读面。
 *
 * 三个侧栏变体（本地项目树 / 工作树列表 / WSL·SSH 连接卡）都要回答同一件事：
 * 「这个项目下有哪些团队」。分组口径只有 `teamsOfProject` 一处实现 —— 宿主只消费结果，
 * 不各写一套归属判据。
 *
 * # 数据来源
 *
 * `teamListStore.list`（`team_list(null)`，全部项目）。侧栏是常驻的，所以它读的是**全量**
 * 清单并在消费侧按项目裁开；用「激活项目」顶替会把别的项目的团队凭空藏起来。
 *
 * 侧栏**不**读 `truncated`：超过后台上界（50 行）时少显示几行是有界退化，"看全部团队"的
 * 地方是团队面板（它读同一份清单）。
 *
 * # 订阅成本
 *
 * 只订阅 `list` 一片（清单只在拉到新结果时替换），因此侧栏各行的 memo 在团队脉冲
 * （别的事件）下不失效。`useMemo` 的依赖是清单引用本身：同一份清单下所有订阅者拿到同一个
 * `Map`，行组件才真的不重画。
 */
export function useTeamsOfProject(): Map<string, TeamSummary[]> {
  const list = useTeamListStore((s) => s.list);
  return useMemo(() => teamsOfProject(list?.teams ?? []), [list]);
}

/**
 * 被某个团队占用的**单元**集合（`WorkspaceSession.key()` 的集合）。
 *
 * 唯一用途：确定哪些工作树不再作为地点行列出（R1' 第 4 条，判据见
 * `utils/teamList::teamUnitKeys`，消费点是 `useTeamFreeWorktrees`）。
 *
 * 与 [`useTeamsOfProject`] 分成两个读面而不是把两件事塞进一个返回对象：一个回答「项目下
 * 有哪些队」（画容器行），一个回答「这棵树被谁占着」（决定列不列那行）。两个消费点的求值
 * 时机不同，合成一个对象只会让两处的 memo 互相拖着失效。
 */
export function useTeamUnitKeys(): Set<string> {
  const list = useTeamListStore((s) => s.list);
  return useMemo(() => teamUnitKeys(list?.teams ?? []), [list]);
}
