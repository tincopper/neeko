import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';

/** 超过该行数启用虚拟滚动（仅渲染视口内行，每行固定行高）。 */
export const OUTPUT_VIRTUALIZE_THRESHOLD = 500;
/** 超过该行数默认折叠为「已折叠 N 行」+ 展开按钮（展开后走虚拟滚动）。 */
export const OUTPUT_COLLAPSE_THRESHOLD = 1000;
/** 虚拟滚动固定行高（px）。 */
export const OUTPUT_LINE_HEIGHT = 20;
/** 虚拟滚动视口默认高度（px）。 */
export const OUTPUT_VIEWPORT_HEIGHT = 320;

export interface OutputScrollProps {
  text: string;
  className?: string;
  testId?: string;
  maxHeight?: number;
}

/**
 * 工具输出滚动容器：小文本直接渲染 `<pre>`；大文本（> 500 行）按行虚拟化，
 * 仅渲染视口内行；超长文本（> 1000 行）默认折叠，点击展开后虚拟化。
 * CommandCard / ReadCard / WorkRows 的 `<pre>` 输出统一改用本组件，
 * 避免几十 KB ~ 几 MB 的输出一次性塞进 DOM 卡死页面。
 */
export default function OutputScroll({ text, className, testId, maxHeight }: OutputScrollProps) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const [expanded, setExpanded] = useState(false);
  const collapsed = lines.length >= OUTPUT_COLLAPSE_THRESHOLD && !expanded;
  const virtualized = !collapsed && lines.length >= OUTPUT_VIRTUALIZE_THRESHOLD;
  const parentRef = useRef<HTMLDivElement>(null);
  const viewportHeight = maxHeight ?? OUTPUT_VIEWPORT_HEIGHT;
  // TanStack Virtual 官方 API；返回函数不可安全 memo（与既有 VirtualList.tsx 同款警告）
  // eslint-disable-next-line react-hooks/incompatible-library -- 库级限制，React Compiler 自动跳过该组件
  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => OUTPUT_LINE_HEIGHT,
    overscan: 10,
    // jsdom 测试与首帧渲染无测量结果时兜底初始视口
    initialRect: { width: 600, height: viewportHeight },
  });

  // 超长文本默认折叠
  if (collapsed) {
    return (
      <div className="output-collapsed" data-testid={testId}>
        <span className="output-collapsed-label">已折叠 {lines.length} 行</span>
        <button type="button" className="output-collapsed-toggle" onClick={() => setExpanded(true)}>
          展开
        </button>
      </div>
    );
  }

  // 小文本直接渲染
  if (!virtualized) {
    return (
      <pre className={className} data-testid={testId}>
        {text}
      </pre>
    );
  }

  // 虚拟滚动：仅渲染视口内行（固定行高，不自动换行，超长行横向滚动）
  return (
    <div
      ref={parentRef}
      className={className}
      data-testid={testId}
      style={{
        whiteSpace: 'pre',
        maxHeight: viewportHeight,
        overflowY: 'auto',
        overflowX: 'auto',
      }}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {rowVirtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-testid="output-line"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: vi.size,
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {lines[vi.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
