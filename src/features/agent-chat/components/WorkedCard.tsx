import { ChevronRight, Undo2 } from 'lucide-react';
import { useState } from 'react';

import type { WorkedSummary } from '../types';
import { formatDuration } from '../utils/chatFormat';

import WorkRows from './WorkRows';

interface WorkedCardProps {
  summary: WorkedSummary;
  /** read_file 路径点击回调（透传给 WorkRows → ReadCard，跳转编辑器打开文件）。 */
  onOpenFile?: (filePath: string) => void;
}

function segments(summary: WorkedSummary): string {
  const parts: string[] = [];
  if (summary.ran > 0) parts.push(`Ran ${summary.ran} command${summary.ran > 1 ? 's' : ''}`);
  if (summary.edited > 0)
    parts.push(`Edited ${summary.edited} file${summary.edited > 1 ? 's' : ''}`);
  if (summary.searched > 0)
    parts.push(`Searched ${summary.searched} file${summary.searched > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * 话轮摘要卡片 —— 对齐原型 `agent-chat-v2.html` 的 `.worked-card`
 * （"Worked for Xs" + 工具分组 + 操作）。Undo 尚无后端支持，置灰保留视觉。
 */
export default function WorkedCard({ summary, onOpenFile }: WorkedCardProps) {
  const [open, setOpen] = useState(true);
  const [groupOpen, setGroupOpen] = useState(true);
  const summaryText = segments(summary);

  return (
    <div className={`worked-card${open ? ' open' : ''}`} data-testid="worked-card">
      <button
        type="button"
        className="worked-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron">
          <ChevronRight size={12} />
        </span>
        <span>Worked for {formatDuration(summary.durationMs)}</span>
      </button>
      {open && (
        <div className="worked-body">
          <div className={`tool-group${groupOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="tool-group-header"
              aria-expanded={groupOpen}
              onClick={() => setGroupOpen((v) => !v)}
            >
              <span className="chevron">
                <ChevronRight size={12} />
              </span>
              <span>{summaryText || 'No tool calls'}</span>
            </button>
            {groupOpen && summary.tools.length > 0 && (
              <div className="work-rows" style={{ paddingLeft: 16 }}>
                <WorkRows tools={summary.tools} onOpenFile={onOpenFile} />
              </div>
            )}
          </div>
          <div className="worked-actions">
            <button type="button" className="worked-btn" disabled title="Undo is not supported yet">
              <Undo2 size={12} /> Undo
            </button>
            <button type="button" className="worked-btn" onClick={() => setGroupOpen((v) => !v)}>
              Review changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
