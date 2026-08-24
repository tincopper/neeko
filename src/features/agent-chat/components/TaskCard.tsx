import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useState } from 'react';

import type { ToolCard } from '../types';

interface TaskCardProps {
  /** 工具卡片数据（title 应为 "general Task: xxx" 格式）。 */
  tool: ToolCard;
}

/**
 * General Task 卡片 —— 显示任务名称和运行状态，点击展开查看输出。
 * 由 `task` 工具卡片驱动（title 格式如 "general Task: 扫描代码库"）。
 */
export default function TaskCard({ tool }: TaskCardProps) {
  const [open, setOpen] = useState(false);
  const hasOutput = Boolean(tool.output);

  const statusIcon =
    tool.status === 'running' ? (
      <Loader2 size={13} className="spin" />
    ) : tool.status === 'failed' ? (
      <X size={13} />
    ) : (
      <Check size={13} />
    );

  const header = (
    <div className="task-head">
      <span className="task-type">task</span>
      <span className="task-name">{tool.title}</span>
      <span className="task-status-icon">{statusIcon}</span>
      <span className="task-status">{tool.status}</span>
    </div>
  );

  return (
    <div className={`task-card ${tool.status}${open ? ' open' : ''}`} data-testid="task-card">
      {hasOutput ? (
        <button
          type="button"
          className="task-header"
          data-testid="task-card-header"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="chevron">
            <ChevronRight size={12} />
          </span>
          {header}
        </button>
      ) : (
        <div className="task-header-static">{header}</div>
      )}
      {hasOutput && open && (
        <div className="task-body" data-testid="task-body">
          <pre>
            <code>{tool.output}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
