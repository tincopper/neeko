import React, { useCallback } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { Button } from '@/ui/Button';

import { usePrDetail } from '../hooks/usePrDetail';
import type { ShowToast } from '../hooks/useRunSingleWorkItem';
import type { TaskItem } from '../viewModel';

import TaskSourceBadge from './TaskSourceBadge';

/**
 * 详情里的 PR 区（design §4.4 的 `pull_request` 动作条，**本期只落 read + open**）。
 *
 * # 为什么这里没有阶段轨 / 编辑 / 删除 / 执行区
 *
 * 那四块都是**本地**工作项的语义：stage 是我们自己的字段（PR 的状态在 GitHub 上）、编辑与
 * 删除写的是本地库、执行区要在本机起终端。把它们画在 PR 详情里，等于承诺「这个面板能改
 * GitHub 上的东西」—— 而这一版**只读**（design §8.2）。所以 PR 详情只呈现事实 + 一个出口。
 *
 * # 为什么「在浏览器打开」要等 `view_pr`
 *
 * `list_prs` 的 `PRListItem` 里**没有 `url`**，地址只能从 `viewPr` 拿。所以按钮先置灰、把
 * 「正在读取 PR 地址…」写在 `title` 上，拿到再亮 —— 而不是自己拼 `https://github.com/<owner>/<repo>/pull/<n>`
 * （仓库名与 host 都可能不是 github.com：企业版、fork、无远端，猜出来的链接会 404 到别人的仓库）。
 *
 * 失败时按钮**不隐藏**，改成置灰 + 旁边一行可读原因 + 「重试」：隐藏会让用户以为这个能力不存在。
 */
interface PrTaskSectionProps {
  /** `source === 'github'` 的工作项（`item.pr` 必存在；缺失时本组件不渲染任何东西）。 */
  item: TaskItem;
  /** 宿主注入的激活项目（`viewPr` 要它解码成 Workspace）。 */
  projectId: string | null;
  /** 打开失败 / 读取失败的提示通道（toast 状态住在面板里）。 */
  showToast: ShowToast;
}

const PrTaskSection: React.FC<PrTaskSectionProps> = React.memo(({ item, projectId, showToast }) => {
  const prNumber = item.pr?.number ?? null;
  const { info, loading, error, reload } = usePrDetail(projectId, prNumber);

  const handleOpen = useCallback(() => {
    const url = info?.url;
    if (url === undefined || url === '') return;
    openInDefaultBrowser(url).catch((err: unknown) => {
      showToast(invokeErrorMessage(err, 'Failed to open browser'), 'error');
    });
  }, [info, showToast]);

  if (item.pr === undefined) return null;
  const pr = item.pr;
  const identifier = pr.repo === '' ? `#${pr.number}` : `${pr.repo}#${pr.number}`;

  // 「能不能点」只看拿到 url 没有：loading 与 error 是两种不同的"还没拿到"，理由各说一句。
  const openDisabled = info?.url === undefined || info?.url === '';
  const openTitle = loading ? 'Loading PR URL…' : (error ?? undefined);

  return (
    <section aria-label="GitHub PR" className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <TaskSourceBadge source={item.source} />
        <span className="text-meta font-medium text-text-primary">{identifier}</span>
        {/* 原始状态（OPEN / MERGED / CLOSED）：列位置是映射结果，用户要能看到未经翻译的值。 */}
        <span data-pr-state={pr.state} className="text-micro text-text-muted">
          {pr.state}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 text-meta">
        {/* base ← head：箭头指向数据流（head 合进 base），不是「现在在哪」。 */}
        <dt className="text-text-muted">Branch</dt>
        <dd className="min-w-0 font-mono text-micro break-all text-text-primary">
          {pr.baseRefName} ← {pr.headRefName}
        </dd>
        <dt className="text-text-muted">Author</dt>
        <dd className="min-w-0 break-all text-text-primary">{pr.author}</dd>
      </dl>

      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleOpen}
          disabled={openDisabled}
          title={openTitle}
        >
          Open in browser
        </Button>
        {error === null ? null : (
          <>
            <p role="alert" className="min-w-0 flex-1 text-micro break-words text-accent-red">
              {error}
            </p>
            <button
              type="button"
              onClick={reload}
              className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
            >
              Retry
            </button>
          </>
        )}
      </div>

      <h4 className="mt-2 text-micro font-semibold text-text-secondary">Description</h4>
      {/* 正文来自 `viewPr`（`PRListItem` 不带 body）：按行渲染，不当 markdown 解析器用。 */}
      <p className="mt-0.5 text-meta break-words whitespace-pre-wrap text-text-primary">
        {info === null || info.body === null || info.body.trim() === '' ? (
          <span className="text-text-muted">
            {loading ? 'Loading PR body…' : '(no description)'}
          </span>
        ) : (
          info.body
        )}
      </p>
    </section>
  );
});
PrTaskSection.displayName = 'PrTaskSection';

export default PrTaskSection;
