import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useScrollbarCompensation } from '@/shared/hooks/useScrollbarCompensation';
import { useProjectStore } from '@/shared/store/projectStore';
import { contentBoxWidthOf } from '@/shared/utils/scrollbarCompensation';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { PdfPageCanvas } from './pdf/PdfPageCanvas';
import {
  clampScale,
  computePageSlots,
  contentHeight,
  fitWidthScale,
  pageIndexAtScrollTop,
  scrollTopOfPage,
  visiblePageRange,
  type PageMetrics,
} from './pdf/pdfPageLayout';
import { PdfToolbar, type PdfViewMode } from './pdf/PdfToolbar';
import { usePdfDocument } from './pdf/usePdfDocument';

/** 页与页之间的垂直间距（连续滚动模式）。 */
const PAGE_GAP = 12;
/** 缩放估算基准页宽（pt）：真实值在首屏渲染后由页面宽高比修正。 */
const FALLBACK_PAGE_WIDTH = 612;
/** 连续滚动时上下额外渲染的页数（避免边界页进入视口才开始解码的白闪）。 */
const OVERSCAN = 2;

interface PdfFileViewProps {
  /** Workspace 相对或绝对路径（后端按 Workspace 解析）。 */
  filePath: string;
  fileName: string;
  /** 归属项目：决定读字节时寻址哪个 Workspace。 */
  projectId?: ProjectId;
}

/**
 * PDF 预览（pdf.js + canvas）。
 *
 * 三个第一性约束决定了实现形状：
 *
 * 1. **必须 JS 解码**：`<iframe src=*.pdf>` 不在三引擎（WKWebView / WebView2 /
 *    WebKitGTK）的能力交集里 —— WebKitGTK 没有内嵌 PDF 渲染。
 * 2. **必须按需取字节**：PDF 的 xref 在文件尾部，打开即随机访问。经
 *    `PDFDataRangeTransport` + `read_file_bytes(offset, length)` 分片拉取，
 *    单次载荷有界、文件总量不设上限（`usePdfDocument`）。
 * 3. **必须虚拟化渲染**：连续滚动只给可视窗口内的页分配 canvas，否则 500 页的
 *    PDF 会一次吃掉几百 MB 位图（`pdfPageLayout`）。
 */
export default function PdfFileView({ filePath, fileName, projectId }: PdfFileViewProps) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const pid = projectId ?? activeProjectId;

  const { doc, numPages, pageAspect, loading, error } = usePdfDocument(pid, filePath);

  const [mode, setMode] = useState<PdfViewMode>('continuous');
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState(1);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 滚动区右内边为 0：改补左内边，让居中页面对齐整个盒子（见 scrollbarCompensation）
  useScrollbarCompensation(scrollRef, 'center');
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // ── 容器测量（虚拟化窗口依赖它）──────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewportHeight(el.clientHeight);
      // 可用宽度 = 内容盒（clientWidth 含两侧内边，含左补偿）——
      // 直接用 clientWidth 会让 fit-width 溢出补偿量（见 scrollbarCompensation.ts）
      setContainerWidth(contentBoxWidthOf(el));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [loading]);

  const metrics: PageMetrics = useMemo(() => {
    const width = FALLBACK_PAGE_WIDTH * scale;
    return { width, height: width * pageAspect, gap: PAGE_GAP };
  }, [scale, pageAspect]);

  const slots = useMemo(() => computePageSlots(numPages, metrics), [numPages, metrics]);

  const [firstVisible, lastVisible] = useMemo(
    () =>
      mode === 'single'
        ? [page - 1, page - 1]
        : visiblePageRange(scrollTop, viewportHeight, numPages, metrics, OVERSCAN),
    [mode, page, scrollTop, viewportHeight, numPages, metrics],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (numPages > 0) {
      setPage(pageIndexAtScrollTop(el.scrollTop, numPages, metrics) + 1);
    }
  }, [numPages, metrics]);

  const gotoPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, numPages), Math.max(1, next));
      setPage(clamped);
      if (mode === 'continuous') {
        const el = scrollRef.current;
        if (el) el.scrollTop = scrollTopOfPage(clamped - 1, metrics);
      }
    },
    [numPages, mode, metrics],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        gotoPage(page - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        gotoPage(page + 1);
      }
    },
    [gotoPage, page],
  );

  // ── 状态分支 ─────────────────────────────────────────────────────────────
  // 未选中项目是**渲染期派生**的（不在 effect 里同步 setState —— 那会级联渲染）。
  if (!pid) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-sm">
        <div className="text-accent-red">Cannot open PDF: {fileName}</div>
        <div className="text-text-muted">No project selected</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-sm">
        <div className="text-accent-red">Cannot open PDF: {fileName}</div>
        <div className="text-text-muted max-w-[60ch] text-center break-words">{error}</div>
      </div>
    );
  }

  if (loading || !doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading PDF…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="pdf-viewer">
      <PdfToolbar
        page={page}
        numPages={numPages}
        scale={scale}
        mode={mode}
        onGotoPage={gotoPage}
        onZoomIn={() => setScale((s) => clampScale(s + 0.25))}
        onZoomOut={() => setScale((s) => clampScale(s - 0.25))}
        onFitWidth={() => setScale(fitWidthScale(containerWidth, FALLBACK_PAGE_WIDTH))}
        onModeChange={setMode}
      />

      {/* 可滚动面板必须能获得焦点（WCAG 2.1.1 键盘可达），role=region 非 interactive 属误报 */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto bg-bg-tertiary/30"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-label={`${fileName} pages`}
      >
        {mode === 'single' ? (
          <div className="flex justify-center p-4">
            <PdfPageCanvas doc={doc} pageNumber={page} width={metrics.width} />
          </div>
        ) : (
          <div style={{ height: contentHeight(numPages, metrics), position: 'relative' }}>
            {slots.slice(firstVisible, lastVisible + 1).map((slot, offset) => {
              const pageNumber = firstVisible + offset + 1;
              return (
                <div
                  key={pageNumber}
                  style={{
                    position: 'absolute',
                    top: slot.top,
                    left: '50%',
                    transform: 'translateX(-50%)',
                  }}
                >
                  <PdfPageCanvas doc={doc} pageNumber={pageNumber} width={metrics.width} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
    </div>
  );
}
