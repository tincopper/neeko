import { Check, ChevronRight, Eye, Loader2, X } from 'lucide-react';
import { useState } from 'react';

import type { ToolCard } from '../types';

import OutputScroll from './OutputScroll';

export interface ReadCardProps {
  tool: ToolCard;
  /** read 卡片路径点击回调（跳转编辑器打开该文件）。 */
  onOpenFile?: (filePath: string) => void;
}

/**
 * 从 read 工具输出中提取被读取的文件路径。
 * 优先取 title（形如路径时）；否则从 opencode 风格的 XML 输出
 * `<path>…</path>` 提取；最后回退 title / 工具名。
 */
export function extractReadPath(tool: ToolCard): string {
  const title = tool.title.trim();
  if (
    title &&
    title !== tool.name &&
    (title.includes('/') || title.includes('\\') || title.startsWith('~'))
  ) {
    return title;
  }
  const fromOutput = tool.output?.match(/<path>([^<]+)<\/path>/);
  if (fromOutput) return fromOutput[1].trim();
  return title || tool.name;
}

/**
 * 从 read 输出中提取文件内容（剥离 `<path>` / `<type>` 等 XML 包装标签）。
 * 无 `<content>` 标签时回退原始输出。
 */
export function extractReadContent(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const m = output.match(/<content>([\s\S]*?)<\/content>/);
  return m ? m[1] : output;
}

/**
 * Read 工具卡片 —— read 操作默认折叠，折叠标题 `read <文件路径>`；
 * 展开才显示读取的文件内容（大文件走 OutputScroll 虚拟滚动）。
 * 由 `read_file` / `read` 工具卡片驱动。
 */
export default function ReadCard({ tool, onOpenFile }: ReadCardProps) {
  const [open, setOpen] = useState(false);
  const path = extractReadPath(tool);
  const content = extractReadContent(tool.output);
  const hasContent = Boolean(content);

  const statusIcon =
    tool.status === 'running' ? (
      <Loader2 size={13} className="spin" />
    ) : tool.status === 'failed' ? (
      <X size={13} />
    ) : (
      <Eye size={13} />
    );

  const headContent = (
    <>
      <span className="file-icon" data-testid="file-icon">
        {statusIcon}
      </span>
      <span className="file-prefix">read</span>
      {onOpenFile ? (
        <button
          type="button"
          className="file-path file-path-link"
          data-testid="file-path-link"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile(path);
          }}
        >
          {path}
        </button>
      ) : (
        <span className="file-path">{path}</span>
      )}
      <span className="file-status" data-testid="file-status" aria-label={tool.status}>
        {tool.status === 'running' ? (
          <Loader2 size={13} className="spin" />
        ) : tool.status === 'failed' ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
      </span>
    </>
  );

  return (
    <div className={`file-card read ${tool.status}${open ? ' open' : ''}`} data-testid="read-card">
      {/* 外层用 div（role=button）而非 <button>：内部路径链接也是 <button>，
          避免 HTML 非法的 button 嵌套。 */}
      <div
        className="file-head-btn"
        data-testid="read-card-header"
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
        {headContent}
        <span className="chevron">
          <ChevronRight size={12} />
        </span>
      </div>
      {open && hasContent && (
        <div className="file-body" data-testid="read-output">
          <OutputScroll text={content!} className="read-content" testId="read-output-scroll" />
        </div>
      )}
    </div>
  );
}
