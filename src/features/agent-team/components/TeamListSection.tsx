import React, { useCallback } from 'react';

import type { TeamList, TeamRef } from '@/shared/types/team';

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
  /**
   * `team_delete` 的失败原文（「先关闭」/「已经不存在」）。
   *
   * 放在这里而不是面板顶部那条通栏：删除入口就在**行**上，失败原因贴着它才有意义。
   * 与上面的 `error`（`team_list` 读失败）分开，因为两者的处置不同 —— 读失败能重试，
   * 删失败要靠用户改主意（先关闭 / 换一个队）。
   */
  deleteError: string | null;
  /** 重拉一次（错误块里的「重试」与右上角的「刷新」是同一个动作）。 */
  onRetry: () => void;
  /** 打开 / 只读查看某个团队。 */
  onOpen: (teamId: string) => void;
  /** 请求关闭某个团队（二次确认由宿主弹）。 */
  onRequestClose: (team: TeamRef) => void;
  /** 请求删除某个团队（同上；可删性由行的 `state` 决定）。 */
  onRequestDelete: (team: TeamRef) => void;
  /** 正在删哪个队（`null` = 没有删除在飞）；只有那一行的按钮置灰。 */
  deletingTeamId: string | null;
  /** 改名（行内提交一次「裁过且真的变了」的名字；落地由宿主负责）。 */
  onRename: (teamId: string, name: string) => void;
}

const TeamListSection: React.FC<TeamListSectionProps> = React.memo(
  ({
    list,
    loading,
    error,
    deleteError,
    onRetry,
    onOpen,
    onRequestClose,
    onRequestDelete,
    deletingTeamId,
    onRename,
  }) => {
    const retry = useCallback(() => onRetry(), [onRetry]);

    return (
      // `flex-1` + `min-h-0`：本块由宿主的分隔条分隔，占住下半区并**自己滚动**。
      // 不给它确定高度（只有 `flex-col`）时，行多起来它会把内容顶到父容器外 —— 用户看不到
      // 下半截，也滚不到（父容器 scrollHeight 比它高）。
      //
      // `border-t` **不是**与分隔条重复的装饰：`ResizableHandle` 默认 `bg-transparent`
      // （只在悬停/拖拽时点亮），`gap-px` 露出的又是同色底 —— 去掉这条线，两层之间就没有
      // 任何可见分隔，用户看不出这里有可拖的边界。
      <section
        aria-label="已有团队"
        className="flex min-h-0 flex-1 flex-col gap-1 border-t border-border p-3"
      >
        <header className="flex shrink-0 items-center justify-between px-1">
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

        {/* 读失败：给重试（原文照抄）。 */}
        <ErrorNotice message={error} onRetry={retry} className="flex shrink-0 flex-col gap-1" />
        {/* 删失败：不给重试按钮 —— 重试的方式是先关闭那个队，不是再按一次删除。 */}
        <ErrorNotice message={deleteError} className="flex shrink-0 flex-col gap-1" />

        {/* 只有**行区**滚动：标题与刷新按钮、错误块与截断提示留在原地。
            整块一起滚时，行多起来用户滚到底就看不到「还有多少行 / 刷新在哪」了。 */}
        <div
          data-testid="team-list-scroller"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto"
        >
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
                  onRequestDelete={onRequestDelete}
                  deletingTeamId={deletingTeamId}
                  onRename={onRename}
                />
              ))}
            </ul>
          )}

          {list?.truncated ? (
            <p className="shrink-0 px-1 text-micro text-text-muted">只显示最近 50 个团队</p>
          ) : null}
        </div>
      </section>
    );
  },
);
TeamListSection.displayName = 'TeamListSection';

export default TeamListSection;
