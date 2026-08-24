import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface ToolGroupSummaryRowProps {
  /** 摘要文本，如 "Ran 3 commands · Edited 2 files"。 */
  summary: string;
  /** 展开后渲染的内容（工具行列表，由调用方传入以保持单向依赖）。 */
  children: ReactNode;
  /** 默认是否展开。 */
  defaultOpen?: boolean;
}

/**
 * 工具调用分组折叠摘要行 —— 对齐 Synara 文档 §14.2.3。
 * 连续的工具调用自动折叠为一个摘要披露器，点击展开查看完整列表。
 * 内容通过 children 注入（避免与 WorkRows 形成循环依赖）。
 */
export default function ToolGroupSummaryRow({
  summary,
  children,
  defaultOpen = false,
}: ToolGroupSummaryRowProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`tool-group${open ? ' open' : ''}`}>
      <button
        type="button"
        className="tool-group-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron">
          <ChevronRight size={12} />
        </span>
        <span>{summary}</span>
      </button>
      {open && <div className="tool-group-body">{children}</div>}
    </div>
  );
}
