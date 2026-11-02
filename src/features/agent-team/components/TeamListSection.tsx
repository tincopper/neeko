import React, { useCallback } from 'react';

import type { TeamList, TeamSummary } from '@/shared/types/team';

import ErrorNotice from './ErrorNotice';
import TeamListRow from './TeamListRow';

/**
 * 团队列表（`team_list` 的呈现）：**这台机器上**的团队，是「重启后重开自己的队」的入口。
 *
 * # 四种状态必须分开
 *
 * | 状态 | 呈现 | 为什么不能合并 |
 * | --- | --- | --- |
 * | 加载中（`list === null && loading`）| 「正在读取团队列表…」| 加载中显示空态 = 谎称「团队都没了」|
 * | 失败且从未成功 | 后端原文 + 重试 | 与「确实一个队都没有」是两件事 |
 * | 空列表 | 「还没有团队，先以队长身份开一个」| 这才是真的空 |
 * | 有行 | 逐行渲染 | — |
 *
 * # 截断提示写在**底部**而不是顶部
 *
 * `truncated` 说的是「最早的那些没列出来」，读它的时机是「翻到底了还没找到我要的队」。
 * 放顶部会变成每进一次面板都要读一遍的噪音。
 *
 * 「50」是后端 `view::MAX_LISTED_TEAMS` 的**文案镜像**（载荷里只有 `truncated` 布尔，没有
 * 上限数字）。改后端上限时这句话要一起改 —— 它是展示文案，不是判据。
 *
 * # 错误 + 重试 + 手动刷新
 *
 * 错误块里的重试入口**只看错误**（不看有没有拿到过清单）：首次拉取就失败时正是最需要它的
 * 时候。右上角的「刷新」是**另一件事**：列表页现在也有脉冲驱动（每次写都会重取），但脉冲只
 * 覆盖「后端推了事件」的情形 —— 事件订阅断了、或者用户就是想确认一眼时，得有一个明确的手动
 * 入口。只在出错时才有刷新按钮，等于把「我看不到变化」这件事变成无解。
 */
interface TeamListSectionProps {
  /** `null` = 还没拿到过（加载中 / 失败且从未成功）。 */
  list: TeamList | null;
  loading: boolean;
  /** `team_list` 的失败原文。 */
  error: string | null;
  /** 重拉一次（错误块里的「重试」与右上角的「刷新」是同一个动作）。 */
  onRetry: () => void;
  /** 打开 / 只读查看某个团队。 */
  onOpen: (teamId: string) => void;
  /** 请求关闭某个团队（二次确认由宿主弹）。 */
  onRequestClose: (team: TeamSummary) => void;
}

const TeamListSection: React.FC<TeamListSectionProps> = React.memo(
  ({ list, loading, error, onRetry, onOpen, onRequestClose }) => {
    const retry = useCallback(() => onRetry(), [onRetry]);

    return (
      <section aria-label="已有团队" className="flex flex-col gap-1 border-t border-border p-3">
        <header className="flex items-center justify-between px-1">
          <h3 className="text-meta font-semibold text-text-secondary">已有团队</h3>
          <div className="flex items-center gap-1.5">
            {list ? (
              <span className="text-micro text-text-muted">{`${list.teams.length} 个`}</span>
            ) : null}
            <button
              type="button"
              onClick={retry}
              aria-label="重新拉取团队列表"
              className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
            >
              刷新
            </button>
          </div>
        </header>

        <ErrorNotice message={error} onRetry={retry} />

        {list === null ? (
          loading ? (
            <p className="px-1 text-meta text-text-muted">正在读取团队列表…</p>
          ) : // 失败且从未成功：错误已在上方，这里只说明后果。
          null
        ) : list.teams.length === 0 ? (
          <p className="px-1 py-1 text-meta text-text-muted">还没有团队，先以队长身份开一个</p>
        ) : (
          <ul aria-label="团队列表" className="flex flex-col gap-1">
            {list.teams.map((team) => (
              <TeamListRow
                key={team.teamId}
                team={team}
                onOpen={onOpen}
                onRequestClose={onRequestClose}
              />
            ))}
          </ul>
        )}

        {list?.truncated ? (
          <p className="px-1 text-micro text-text-muted">只显示最近 50 个团队</p>
        ) : null}
      </section>
    );
  },
);
TeamListSection.displayName = 'TeamListSection';

export default TeamListSection;
