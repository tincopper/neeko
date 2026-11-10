import { RefreshCw } from 'lucide-react';
import React from 'react';

import { useAppConfig } from '@/features/settings';
import type { TaskDetail } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { MarkdownPreview } from '@/ui/MarkdownPreview';

import { fetchTaskDetail } from '../api/teamApi';

import Chip from './Chip';

/**
 * 团队**任务详情**的中央 tab 视图（替代旧的底部抽屉）。
 *
 * # 为什么是 tab 而不是抽屉
 *
 * 派活正文经常是 markdown 长文（任务步骤、验收标准），底部抽屉的高度挤不下；
 * tab 形态占整个中心区，且可以与队长终端 / 看板并排对照。详情**点开才拉**（红线 4）：
 * tab data 只带地址，本组件挂载时发 `team_task_detail`，关 tab 即弃 —— 不进 store。
 *
 * # 「开工文档」与「完成回报」不覆盖
 *
 * `body`（队长写下的派活文档）与 `summary`（成员的完成回报）是**两个独立字段**，
 * 各自一节并排呈现；中间发生了什么看 `steps`（审计轨迹：claim / update / 信号 /
 * 回收，最新在前）—— 每一步都可见，不被最后一条覆盖。
 */
interface TeamTaskCenterViewProps {
  teamId: string;
  taskId: string;
}

const TeamTaskCenterView: React.FC<TeamTaskCenterViewProps> = React.memo(({ teamId, taskId }) => {
  const [detail, setDetail] = React.useState<TaskDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { config } = useAppConfig();
  /** 在飞代数：换队 / 换任务 / 卸载后，迟到的响应不许再 setState（也避免重复加载）。 */
  const loadSeq = React.useRef(0);

  /**
   * 唯一的取数路径（挂载与「重新读取」共用）。
   *
   * 两条必须守住的：① 先清 `error` —— 重试成功后旧错误不能还挂在正文上（否则
   * `error ? <错误> : <内容>` 永远走错误分支，重试永远「看起来没成功」）；
   * ② 代数守卫 —— 卸载 / 换任务的响应不得再落 state。
   */
  const load = React.useCallback(() => {
    const mine = ++loadSeq.current;
    setLoading(true);
    setError(null);
    fetchTaskDetail(teamId, taskId)
      .then((next) => {
        if (mine !== loadSeq.current) return;
        setDetail(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== loadSeq.current) return;
        setError(invokeErrorMessage(err, 'Could not load the task detail'));
        setLoading(false);
      });
  }, [teamId, taskId]);

  React.useEffect(() => {
    load();
    // 卸载即作废旧请求（代数自增）。
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  const reload = React.useCallback(() => {
    load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-secondary">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate text-ui font-semibold text-text-primary">
          {detail ? detail.title : taskId}
        </span>
        <span className="shrink-0 font-mono text-micro text-text-muted">{taskId}</span>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={reload}
          aria-label="重新读取任务详情"
          className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !detail ? (
          <p className="text-meta text-text-muted">正在读取任务详情…</p>
        ) : error ? (
          <p role="alert" className="whitespace-pre-wrap text-meta text-accent-red">
            {error}
          </p>
        ) : detail === null ? null : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {/* 开工文档（队长写下的派活正文；markdown 渲染） */}
            <section aria-label="开工文档" className="flex flex-col gap-1.5">
              <h3 className="text-meta font-semibold text-text-secondary">开工文档</h3>
              <div className="rounded-lg border border-border bg-bg-primary p-3">
                <MarkdownPreview content={detail.body} theme={config.theme ?? 'dark'} />
              </div>
            </section>

            {/* 完成回报（成员的 summary；与开工文档并存，不被覆盖） */}
            {detail.summary !== null ? (
              <section aria-label="完成回报" className="flex flex-col gap-1.5">
                <h3 className="text-meta font-semibold text-text-secondary">
                  完成回报
                  {detail.summaryTruncated ? (
                    <span className="ml-1.5 text-micro font-normal text-accent-yellow">
                      （已截断到 4KB）
                    </span>
                  ) : null}
                </h3>
                <div className="rounded-lg border border-border bg-bg-primary p-3">
                  <MarkdownPreview content={detail.summary} theme={config.theme ?? 'dark'} />
                </div>
              </section>
            ) : null}

            {/* 产物引用 */}
            {detail.artifacts.length > 0 ? (
              <section aria-label="产物" className="flex flex-col gap-1.5">
                <h3 className="text-meta font-semibold text-text-secondary">产物</h3>
                <div className="flex flex-wrap gap-1">
                  {detail.artifacts.map((artifact) => (
                    <Chip key={`${artifact.kind}-${artifact.value}`} tone="outline">
                      {artifact.value}
                    </Chip>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 步骤轨迹（最新在前；每一步可见，不被最后一条覆盖） */}
            <section aria-label="步骤轨迹" className="flex flex-col gap-1.5">
              <h3 className="text-meta font-semibold text-text-secondary">
                步骤轨迹
                {detail.stepsTruncated ? (
                  <span className="ml-1.5 text-micro font-normal text-text-muted">
                    （只显示最近 {detail.steps.length} 条）
                  </span>
                ) : null}
              </h3>
              {detail.steps.length === 0 ? (
                <p className="text-micro text-text-muted">还没有步骤记录。</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {detail.steps.map((step, index) => (
                    <li
                      key={`${step.at}-${step.kind}-${index}`}
                      className="flex items-center gap-2 rounded-md border border-border bg-bg-primary px-2 py-1.5"
                    >
                      <span className="shrink-0 font-mono text-micro text-text-muted">
                        {new Date(step.at).toLocaleTimeString()}
                      </span>
                      <Chip tone="accent">{step.kind}</Chip>
                      <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
                        {step.actor}
                        {step.detail ? `：${step.detail}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
});
TeamTaskCenterView.displayName = 'TeamTaskCenterView';

export default TeamTaskCenterView;
