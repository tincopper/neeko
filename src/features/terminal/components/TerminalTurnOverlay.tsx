import React from 'react';

/**
 * 终端视图的**呈现态**（覆盖层要说的三种情况之一）。
 *
 * 三态而不是「`ready: boolean` + `attachFailed: boolean`」：两个布尔量能拼出「既 ready 又
 * failed」这种不存在的状态，而「连上了」与「接回失败」本来就是同一件事的互斥结果。
 */
export type TurnView = 'connecting' | 'ready' | 'attach-failed';

interface TerminalTurnOverlayProps {
  turnView: TurnView;
}

/**
 * 终端上方的状态覆盖层（`ready` 时什么都不渲染）。
 *
 * 从 `TerminalViewBase` 抽出来的原因只有一个：那个文件已登记在组件体积基线里（ratchet 只许
 * 缩小），而覆盖层是**纯表现**、与 xterm 生命周期无关的一块。抽取不迁移任何行为。
 *
 * # 接回失败为什么没有按钮
 *
 * `attach-failed` 表示「调用方要求接回的那条 PTY 已经结束」。恢复动作属于**调用方**：花名册的
 * 五态判据（`utils/memberTerminal.ts`）与侧栏 `sessionTabFactory` 的 resume 分支各自知道
 * 该续写还是该看历史。终端视图看不到 `resumable` / `sealed` 两列，在这里再放一个「重新打开」
 * 就是第三套判据，而它必然猜错 —— 猜错的形态正是本覆盖层要消灭的那一个（起一条裸 CLI 冒充
 * 团队成员）。
 */
const TerminalTurnOverlay: React.FC<TerminalTurnOverlayProps> = ({ turnView }) => {
  if (turnView === 'connecting') {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center text-text-secondary text-[var(--terminal-font-size)]">
        Connecting...
      </div>
    );
  }

  if (turnView === 'attach-failed') {
    return (
      <div
        role="status"
        data-testid="terminal-attach-failed"
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 px-6 text-center text-text-secondary text-[var(--terminal-font-size)]"
      >
        <span>This session has ended.</span>
        <span className="text-[0.82em] opacity-70">
          Close the tab and reopen it from where you opened it.
        </span>
      </div>
    );
  }

  return null;
};

export default React.memo(TerminalTurnOverlay);
