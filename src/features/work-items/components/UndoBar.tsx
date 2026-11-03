import React, { useEffect } from 'react';

import { Button } from '@/ui/Button';

/**
 * 删除后的撤销条（PRD US-CRUD-6 / design §11.4）：**5 秒窗口**，到点自动收起。
 *
 * # 为什么是面板内的一条，而不是 shared toast
 *
 * 全仓 toast 是 3 秒、无动作按钮，而撤销窗口是 5 秒且需要一个按钮 —— 两个计时器同时跑必然
 * 漂移（toast 先消失，用户看着空白的列表，撤销入口已经没了）。所以这里不碰 shared toast：
 * 撤销**只有**一条通道（本组件 + `undoDelete()` 的返回值）。
 *
 * # 窗口的判断以 store 返回值为准，不以本组件的计时器为准
 *
 * 计时器只负责「自动收起」，它和 store 里那个延迟提交的定时器是两个独立时钟 —— 主线程卡一下
 * 就可能一个到点先跑。所以点「撤销」时以 `undoDelete()` 的返回值结算：`false` = 窗口已过
 * （或已被撤过），此时**直接收起且不提示成功**，因为那次删除已经真的提交了。
 *
 * # 换了一条被删项时计时器必须**重起**
 *
 * 5 秒内连删两行时宿主只渲染一个本组件（`title` 变了、组件没卸载）。若计时器只依赖
 * `onExpire` / `windowMs`，第二条的条子会继承**第一条**的起点：它在 t=5 收起，而 store 里第二
 * 条的窗口到 t=6 才关 —— 中间那一秒里删除仍可撤销，界面上却已经没有入口了。所以 `title`
 * 必须在依赖里（与 `shared/hooks/useToast` 换消息时 `clearTimeout` 再排钟同一条纪律）。
 *
 * # 文案里带上被删标题
 *
 * 「已删除 1 条工作项」无法让用户确认删的是不是他刚删的那条 —— 撤销窗口只有 5 秒，这一句
 * 是他唯一的核对依据。
 */
interface UndoBarProps {
  /** 被删工作项的标题（文案里点名）。 */
  title: string;
  /** 用户点了「撤销」：宿主调 `undoDelete()` 并**按返回值**决定是否提示成功。 */
  onUndo: () => void;
  /** 窗口到点（宿主收起本条）。 */
  onExpire: () => void;
  /** 撤销窗口毫秒数。默认是 store 的 `UNDO_WINDOW_MS` 的同值（那个常量未导出）。 */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 5000;

const UndoBar: React.FC<UndoBarProps> = React.memo(
  ({ title, onUndo, onExpire, windowMs = DEFAULT_WINDOW_MS }) => {
    useEffect(() => {
      const timer = setTimeout(onExpire, windowMs);
      return () => clearTimeout(timer);
      // `title` 入依赖：换了一条被删项就换一个窗口，计时器必须跟着重起（见文件头）。
    }, [onExpire, title, windowMs]);

    return (
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-tertiary px-2 py-1"
      >
        <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
          {`已删除「${title}」`}
        </span>
        <Button variant="secondary" size="sm" onClick={onUndo}>
          撤销
        </Button>
      </div>
    );
  },
);
UndoBar.displayName = 'UndoBar';

export default UndoBar;
