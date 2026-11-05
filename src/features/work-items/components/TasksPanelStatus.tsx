import React from 'react';

import { cn } from '@/lib/utils';

/**
 * 面板的两条**非阻塞状态条**：读路径错误（顶部）+ 动作反馈（底部）。
 *
 * # 为什么合成一个组件
 *
 * 它们是同一件事的两种形态 —— 一句顶/底横幅，不进对话框、不抢焦点、不阻塞操作。分开写会得到
 * 两段几乎一样的 JSX（同样的 `shrink-0 border-* px-2 py-1 text-micro break-words`），
 * 而它们的差别只有「来自哪里」和「能不能重试」。
 *
 * # 通道分工不能合并
 *
 * | 来源 | 位置 | 为什么 |
 * | --- | --- | --- |
 * | `load` / 5 秒后的延迟提交删除 → `store.errors` | 顶部 + 重试 | 读路径没有调用方可以 catch；重试是用户唯一的下一步 |
 * | `create` / `update` / `transition` 失败 → Promise 抛出 | 底部（`useToast`） | 调用点知道自己在干什么；一次动作失败不该常驻成「这个项目坏了」 |
 *
 * 把动作失败也塞进顶部会得到「常驻横幅」，把读路径失败改成 toast 会让错误在 3 秒后消失而
 * 数据仍然没有。两个通道都保留，但**一个失败只报一次**。
 *
 * # provider 的错误为什么是**另一条**横幅
 *
 * 本地列表（SQLite）与 GitHub（`gh` CLI）的重试是两件不同的事：点「重试」却只重拉本地时，
 * PR 的错会永远停留。所以两条横幅各带自己的重试入口，谁也不替谁重试。文案由调用方拼好
 * （它才知道是哪个 provider），本组件只负责呈现。
 */
interface TasksPanelStatusProps {
  /** 读路径错误（`null` = 没有）。 */
  error: string | null;
  /** 重新拉列表（同项目在飞会被 store 复用）。 */
  onRetry: () => void;
  /** 外部 provider 的读失败（已带 provider 名字）；`null` = 没有。 */
  providerError: string | null;
  /** 只重拉那个 provider（不牵连本地列表）。 */
  onRetryProvider: () => void;
  /** 动作反馈（`useToast` 的当前值；`null` = 没有在显示）。 */
  toast: { message: string; type: 'info' | 'error' } | null;
}

/** 两条横幅共用同一形状：一句顶栏 + 一个重试按钮。 */
interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

const ErrorBanner: React.FC<ErrorBannerProps> = React.memo(({ message, onRetry }) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
    {/* `role="alert"`：读路径失败是「用户没做任何事也可能需要知道」的状态变化。 */}
    <p role="alert" className="min-w-0 flex-1 text-micro break-words text-accent-red">
      {message}
    </p>
    <button
      type="button"
      onClick={onRetry}
      className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
    >
      Retry
    </button>
  </div>
));
ErrorBanner.displayName = 'ErrorBanner';

const TasksPanelStatus: React.FC<TasksPanelStatusProps> = React.memo(
  ({ error, onRetry, providerError, onRetryProvider, toast }) => (
    <>
      {error === null ? null : <ErrorBanner message={error} onRetry={onRetry} />}
      {providerError === null ? null : (
        <ErrorBanner message={providerError} onRetry={onRetryProvider} />
      )}

      {toast === null ? null : (
        <div
          // info 用 `status`（不打断），error 用 `alert`（读屏立刻播报）。
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'shrink-0 border-t border-border px-2 py-1 text-micro break-words',
            toast.type === 'error' ? 'text-accent-red' : 'text-text-secondary',
          )}
        >
          {toast.message}
        </div>
      )}
    </>
  ),
);
TasksPanelStatus.displayName = 'TasksPanelStatus';

export default TasksPanelStatus;
