import { Loader2 } from 'lucide-react';

interface WorkingIndicatorProps {
  /** Duration the turn has been running, in milliseconds. */
  durationMs: number;
  /** Description of the currently active tool, if any. */
  activeTool: string | null;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}

/**
 * 实时回合指示器 —— Agent 处理中显示 "Working…" + 持续时间 + 当前工具。
 * 非折叠，持续计数，活动步骤显示 spinner。
 */
export default function WorkingIndicator({ durationMs, activeTool }: WorkingIndicatorProps) {
  return (
    <div className="working-indicator" data-testid="working-indicator">
      <Loader2 size={14} className="spin working-spinner" />
      <span className="working-text">Working… {formatDuration(durationMs)}</span>
      {activeTool && <span className="working-tool">{activeTool}</span>}
    </div>
  );
}
