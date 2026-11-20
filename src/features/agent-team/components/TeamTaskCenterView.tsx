import { RefreshCw, RotateCcw } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';
import { useConfig } from '@/shared/contexts';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import type { TaskDetail } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { MarkdownPreview } from '@/ui/MarkdownPreview';

import { fetchTaskDetail } from '../api/teamApi';
import { useTaskRetry } from '../hooks/useTaskRetry';
import { canRetry } from '../utils/taskBoard';

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
 * 各自一节并排呈现；中间发生了什么看 `events`（审计轨迹：claim / update / 信号 /
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
  // 只读订阅主题（别调旧 owner hook：第二个 owner 会翻转主题闪黑，见 `configProjection`）。
  const theme = useConfig((c) => c.theme);
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

  // R6：产物路径点击复制（交接改引用制 —— 路径就是要被下一个成员使用的实体）。
  const copy = useCopyToClipboard();

  // 详情头部的「重试」：判据 canRetry 与看板卡片同源（failed / blocked 才渲染）。
  // 成功后除了 hook 里的快照刷新，还要 reload 本地详情 —— 这个 tab 的数据是自持的
  // （点开才拉），不经过 store，脉冲刷不到它。
  const { busy: retryBusy, error: retryError, retry } = useTaskRetry();
  const handleRetry = React.useCallback(() => {
    void retry(teamId, taskId).then((ok) => {
      if (ok) reload();
    });
  }, [retry, teamId, taskId, reload]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-secondary">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate text-ui font-semibold text-text-primary">
          {detail ? detail.title : taskId}
        </span>
        <span className="shrink-0 font-mono text-micro text-text-muted">{taskId}</span>
        <span className="ml-auto" />
        {detail && canRetry(detail.state) ? (
          <button
            type="button"
            onClick={handleRetry}
            disabled={retryBusy}
            data-testid="task-retry"
            className={cn(
              'flex items-center gap-1 rounded-md border border-border px-2 py-1 text-micro font-semibold text-text-secondary',
              'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
              retryBusy && 'cursor-default opacity-60',
            )}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Retry
          </button>
        ) : null}
        <button
          type="button"
          onClick={reload}
          aria-label="Reload task details"
          className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </header>
      {retryError ? (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-3 py-1.5 text-micro text-accent-red"
        >
          {retryError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !detail ? (
          <p className="text-meta text-text-muted">Loading task details…</p>
        ) : error ? (
          <p role="alert" className="whitespace-pre-wrap text-meta text-accent-red">
            {error}
          </p>
        ) : detail === null ? null : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {/* 开工文档（队长写下的派活正文；markdown 渲染） */}
            <section aria-label="Briefing" className="flex flex-col gap-1.5">
              <h3 className="text-meta font-semibold text-text-secondary">Briefing</h3>
              <div className="rounded-lg border border-border bg-bg-primary p-3">
                <MarkdownPreview content={detail.body} theme={theme} />
              </div>
            </section>

            {/* 完成回报（成员的 summary；与开工文档并存，不被覆盖） */}
            {detail.summary !== null ? (
              <section aria-label="Completion report" className="flex flex-col gap-1.5">
                <h3 className="text-meta font-semibold text-text-secondary">
                  Completion report
                  {detail.summaryTruncated ? (
                    <span className="ml-1.5 text-micro font-normal text-accent-yellow">
                      (truncated at 4KB)
                    </span>
                  ) : null}
                </h3>
                <div className="rounded-lg border border-border bg-bg-primary p-3">
                  <MarkdownPreview content={detail.summary} theme={theme} />
                </div>
              </section>
            ) : null}

            {/* 产物引用（R6）：点击复制路径 —— 交接改引用制后，路径就是要被下一个成员
                使用的实体；chip 上带 kind 标注。不新开 tab 类型（PRD 的边界）。 */}
            {detail.artifacts.length > 0 ? (
              <section aria-label="Artifacts" className="flex flex-col gap-1.5">
                <h3 className="text-meta font-semibold text-text-secondary">Artifacts</h3>
                <div className="flex flex-wrap gap-1">
                  {detail.artifacts.map((artifact) => (
                    <button
                      key={`${artifact.kind}-${artifact.value}`}
                      type="button"
                      onClick={() => copy(artifact.value, 'Artifact path')}
                      data-testid="artifact-chip"
                      title={`${artifact.kind}: click to copy ${artifact.value}`}
                      className={cn(
                        'rounded-md border border-border bg-bg-primary px-2 py-0.5 text-micro text-text-secondary',
                        'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                      )}
                    >
                      {artifact.value}
                    </button>
                  ))}
                </div>
                <p className="text-micro text-text-muted">
                  Click to copy the path (by reference: the peer reads it by path)
                </p>
              </section>
            ) : null}

            {/* 步骤轨迹（最新在前；每一步可见，不被最后一条覆盖） */}
            <section aria-label="Activity log" className="flex flex-col gap-1.5">
              <h3 className="text-meta font-semibold text-text-secondary">
                Activity log
                {detail.eventsTruncated ? (
                  <span className="ml-1.5 text-micro font-normal text-text-muted">
                    (showing the latest {detail.events.length})
                  </span>
                ) : null}
              </h3>
              {detail.events.length === 0 ? (
                <p className="text-micro text-text-muted">No steps recorded yet.</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {detail.events.map((step, index) => (
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
                        {step.detail ? `: ${step.detail}` : ''}
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
