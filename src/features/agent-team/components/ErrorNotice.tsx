import React, { useCallback } from 'react';

/**
 * 「拿失败了 + 重试」这一块（团队域唯一一份）。
 *
 * # 为什么要收成一个组件
 *
 * 这句话在三个块里逐字重复过（队长入口的清单、团队配置、团队列表），连同那个 `role="alert"`
 * 与外链式的重试按钮。重复的代价不是行数，而是**它们会各自漂移**：一处补了「失败不清数据」
 * 的措辞、另一处还留着「操作失败」；一处把重试按钮放在错误上方、另一处放在下方。
 *
 * # 两条纪律写在组件里
 *
 * 1. **原文照抄**：后端 `AppError` 的 `Display` 已经是给人看的句子，前端改写会把唯一有用的
 *    信息丢掉（见 `shared/utils/invokeError`）。
 * 2. **重试入口只看错误、不看有没有拿到过数据**：首次拉取就失败时正是最需要它的时候
 *    （`message === null` 时整块不存在，也就没有空转的按钮）。
 */
interface ErrorNoticeProps {
  /** 失败原文；`null` = 没有错误（整块不渲染）。 */
  message: string | null;
  /** 重试按钮的文案；与 `onRetry` 一起省略 = 这块不给重试入口。 */
  retryLabel?: string;
  onRetry?: () => void;
  /** 额外类名（窄面板 / 大面板的排布不同，但文案与角色一致）。 */
  className?: string;
}

const ErrorNotice: React.FC<ErrorNoticeProps> = React.memo(
  ({ message, retryLabel, onRetry, className }) => {
    const retry = useCallback(() => onRetry?.(), [onRetry]);

    if (message === null) return null;

    return (
      <div className={className === undefined ? 'flex flex-col gap-1' : className}>
        <p role="alert" className="whitespace-pre-wrap break-words text-meta text-accent-red">
          {message}
        </p>
        {onRetry === undefined ? null : (
          <button
            type="button"
            onClick={retry}
            className="self-start rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            {retryLabel ?? 'Retry'}
          </button>
        )}
      </div>
    );
  },
);
ErrorNotice.displayName = 'ErrorNotice';

export default ErrorNotice;
