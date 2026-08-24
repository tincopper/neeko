import { ArrowRight, GitCommitHorizontal } from 'lucide-react';
import { useState } from 'react';

import type { FileChangeSummary } from '../types';
import { classifyDiffLine, isDiffLine } from '../utils/diffHighlight';

interface FilesChangedCardProps {
  summary: FileChangeSummary;
}

/**
 * Files changed 卡片 —— 对齐原型 `agent-chat-v2.html` 的 `.diff-card`：
 * 标题 + Review 按钮 + 文件列表（路径 + +N/-N）。点击 Review 展开内联 diff。
 */
export default function FilesChangedCard({ summary }: FilesChangedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { files, diffs } = summary;

  return (
    <div className="diff-card" data-testid="files-changed-card">
      <div className="diff-header">
        <span>
          <GitCommitHorizontal
            size={14}
            style={{ color: 'var(--text-muted)', marginRight: 6, verticalAlign: -1 }}
          />
          Files changed
        </span>
        <button type="button" className="diff-review-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse' : 'Review'} <ArrowRight size={12} />
        </button>
      </div>
      <div className="diff-files">
        {files.map((f) => (
          <div key={f.path} className="diff-file">
            <span className="path">{f.path}</span>
            {f.add > 0 && <span className="stat stat-add">+{f.add}</span>}
            {f.del > 0 && <span className="stat stat-del">-{f.del}</span>}
          </div>
        ))}
      </div>
      {expanded &&
        diffs.map((d) => (
          <div key={d.path} className="diff-expand">
            <div className="diff-expand-head">{d.path}</div>
            <pre>
              <code>
                {d.diff.split('\n').map((line, i) => {
                  const kind = classifyDiffLine(line);
                  return (
                    <span key={i} className={`dl${isDiffLine(kind) ? ` ${kind}` : ''}`}>
                      {line}
                    </span>
                  );
                })}
              </code>
            </pre>
          </div>
        ))}
    </div>
  );
}
