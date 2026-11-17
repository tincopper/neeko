import { useCallback, useEffect, useMemo } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';
import type { TeamList } from '@/shared/types/team';

import { useTeamListStore } from '../store/teamListStore';

import { usePulseRefresh } from './usePulseRefresh';

/**
 * 团队清单（`team_list`）的**消费面**：把 store 里的整份清单裁成「激活项目的团队」。
 *
 * # 数据在 store，不在这个 hook 里（2026-11-17）
 *
 * 清单原来是**面板局部**的 `useState`（挂载拉、卸载丢）。侧栏团队行是常驻的，再拉一份就是
 * 同一个资源两套轮询 + 两份「上次成功的结果」。现在：
 *
 * | 责任 | 归属 |
 * | --- | --- |
 * | 拉取 / 三态 / 失败不清空 / 代数守卫 | `store/teamListStore` |
 * | 订阅 + `rev` 去重（全局唯一 `listen`） | `store/teamStore::ensureTeamPulseListener` |
 * | 合并窗口 / 在飞排队 / 卸载闩 | `hooks/usePulseRefresh` |
 * | **按激活项目裁剪** | **本 hook** |
 *
 * # 为什么过滤在消费侧（面板只看当前项目）
 *
 * 请求口径是「全部项目」（`fetchTeamList(null)`）：侧栏要列**所有**项目下的团队，用激活
 * 项目顶替会把别的项目的团队凭空藏起来。面板则只该显示当前项目的 —— 这是**消费侧**的
 * 视图裁剪，不是请求口径，所以落在这一层。
 *
 * 顺带也丢掉了空 `project_id` 的旧行（v16 之前建的）：它们无法归属到任何项目，显示在
 * 「全部」里反而让用户以为它们属于当前项目 —— 与后端曾经按 id 过滤时的口径一致。
 *
 * # 跟随项目（2026-11-08）仍然成立
 *
 * 切项目 = 换一份清单 **视图**（不需要重拉：清单本来就是全量的）。没有激活项目时裁剪结果
 * 是空清单 —— 没有项目就没有可归属的团队。
 *
 * # 已知的有界退化（诚实记账，不是缺陷修复对象）
 *
 * 后端上界是 `MAX_LISTED_TEAMS = 50` 且**曾经在截断之前**过滤项目。现在截断发生在跨项目
 * 之后、过滤在前端：一台机器上团队超过 50 个时，面板看到的行数可能比以前少。`truncated`
 * 原样透传（面板据此说「只显示最近 50 个」）；「看全部团队」的地方是面板本身。
 */

export interface TeamListState {
  /** `null` = 还没拿到过清单（首次加载 / 失败且从未成功）。 */
  list: TeamList | null;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 重新拉取（失败重试 / 列表页的「刷新」/ 关闭团队之后）。 */
  reload: () => void;
}

/**
 * 把全量清单裁到某个项目。
 *
 * 只有 `projectId` **相等**一种判据：从路径前缀猜归属是第二套身份判据（红线 12），
 * 而 `TeamSummary.projectId` 就是后端落库的那个字段。
 */
function scopeToList(list: TeamList | null, projectId: string | null): TeamList | null {
  if (list === null) return null;
  return { ...list, teams: list.teams.filter((team) => team.projectId === projectId) };
}

export function useTeamList(): TeamListState {
  // 视图裁剪的输入（**不是**请求口径）：切项目只换视图，不换那份全量清单。
  const projectId = useProjectStore((s) => s.activeProjectId);
  const list = useTeamListStore((s) => s.list);
  const loading = useTeamListStore((s) => s.loading);
  const error = useTeamListStore((s) => s.error);
  // 清单面的脉冲水位：与快照面各一份（两块数据、两个读面）。
  const rev = useTeamListStore((s) => s.lastRev);

  const reload = useCallback(() => {
    // 按钮 / 宿主的入口只要「开始拉」，不关心落地（`onSettled` 之类的回调链不 await 它）。
    void useTeamListStore.getState().refresh();
  }, []);

  // 挂载即拉一次（面板在 dock 里反复挂载卸载；store 会保留上一次成功的结果，所以这只是一次
  // 确认性的重取，不会闪空）。
  useEffect(() => {
    void useTeamListStore.getState().refresh();
  }, []);

  /**
   * 脉冲 → 合并重取。
   *
   * **这就是清单的失效源**：团队/成员/任务的任何写路径都会推一条脉冲。修之前列表那处
   * 漏了订阅（`useTeamPanel` 的订阅被 `if (!teamId) return` 关掉，而列表态的 `teamId`
   * 恰好是 `null`），于是「建了队、按了返回列表，看到的还是建队前的清单」。
   */
  usePulseRefresh(useTeamListStore.getState().refresh, { rev });

  const scoped = useMemo(() => scopeToList(list, projectId), [list, projectId]);

  return { list: scoped, loading, error, reload };
}
