import React from 'react';

interface TerminalScrollToBottomProps {
  /** 视口是否已经在底部（在底部时按钮淡出且不可点）。 */
  isAtBottom: boolean;
  onClick: () => void;
}

/**
 * 「回到底部」浮标（终端右下角的箭头）。
 *
 * 从 `TerminalViewBase` 抽出来的原因与 [`TerminalTurnOverlay`](./TerminalTurnOverlay.tsx) 相同：
 * 那个文件已登记在组件体积基线里（ratchet 只许缩小），而这块是**纯表现**，不碰 xterm 生命周期。
 *
 * 透明而非隐藏：`opacity` 过渡让它在用户往上翻时平滑出现；`pointerEvents` 随可见性切换，
 * 否则一个看不见的按钮会吃掉终端里的点击。
 */
const TerminalScrollToBottom: React.FC<TerminalScrollToBottomProps> = React.memo(
  ({ isAtBottom, onClick }) => (
    <button
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-8 h-8 rounded bg-bg-surface border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-opacity duration-150 cursor-pointer"
      style={{ opacity: isAtBottom ? 0 : 1, pointerEvents: isAtBottom ? 'none' : 'auto' }}
      onClick={onClick}
      title="Scroll to bottom"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M7 10L3 5H11L7 10Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  ),
);
TerminalScrollToBottom.displayName = 'TerminalScrollToBottom';

export default TerminalScrollToBottom;
