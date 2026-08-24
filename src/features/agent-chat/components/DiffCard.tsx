import { Check, ChevronRight, Loader2, Pencil, X } from 'lucide-react';
import { useState } from 'react';

import type { ToolCard } from '../types';
import { classifyDiffLine, isDiffLine, isDiffOutput } from '../utils/diffHighlight';

import MessageContent from './MessageContent';

export interface DiffCardProps {
  tool: ToolCard;
}

/**
 * Diff 工具卡片 —— edit_file / write_file 的改动以独立 diff 卡片展示。
 * 输出按内容分流：unified diff → 对比高亮（add/rem/hunk 行着色）；
 * 非 diff 输出（错误信息/说明文本）→ markdown 渲染（复用 MessageContent）。
 * 默认展开，可折叠。由 `edit_file` / `write_file` 工具卡片驱动。
 */
export default function DiffCard({ tool }: DiffCardProps) {
  const [open, setOpen] = useState(true);
  const hasOutput = Boolean(tool.output);
  const isDiff = hasOutput && isDiffOutput(tool.output!);

  const statusIcon =
    tool.status === 'running' ? (
      <Loader2 size={13} className="spin" />
    ) : tool.status === 'failed' ? (
      <X size={13} />
    ) : (
      <Pencil size={13} />
    );

  return (
    <div className={`diff-card edit ${tool.status}${open ? ' open' : ''}`} data-testid="diff-card">
      <div
        className="diff-header diff-header-btn"
        data-testid="diff-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="diff-head-left">
          <span className="diff-icon" data-testid="diff-icon">
            {statusIcon}
          </span>
          <span className="diff-path">{tool.title}</span>
        </span>
        <span className="file-status" data-testid="diff-status" aria-label={tool.status}>
          {tool.status === 'running' ? (
            <Loader2 size={13} className="spin" />
          ) : tool.status === 'failed' ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="chevron">
          <ChevronRight size={12} />
        </span>
      </div>
      {open && hasOutput && (
        <div className="diff-expand" data-testid="diff-output">
          {isDiff ? (
            <>
              <div className="diff-expand-head">{tool.title}</div>
              <pre>
                <code>
                  {tool.output!.split('\n').map((line, i) => {
                    const kind = classifyDiffLine(line);
                    return (
                      <span key={i} className={`dl${isDiffLine(kind) ? ` ${kind}` : ''}`}>
                        {line}
                      </span>
                    );
                  })}
                </code>
              </pre>
            </>
          ) : (
            <div className="diff-expand-markdown">
              <MessageContent text={tool.output!} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
