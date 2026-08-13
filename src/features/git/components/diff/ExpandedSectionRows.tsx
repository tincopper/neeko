import React from 'react';

import {
  collapsedSectionRanges,
  findFullHunkForOldLine,
  spliceFullHunkSection,
} from './diffViewUtils';
import type { DiffPos } from './diffViewUtils';
import { renderHighlightedHtml } from './highlight';
import type { DiffHunk } from './types';

interface ExpandedSectionRowsProps {
  hunk: DiffHunk;
  hunkIdx: number;
  /** hunk.lines 中 Collapsed 占位行的索引（用于定位折叠区间）。 */
  sourceLineIdx: number;
  /** 选区/展开 key 使用的行索引（unified=hunk.lines 索引，split=buildSplitRows rowIndex）。 */
  keyLineIdx: number;
  fullHunks?: DiffHunk[];
  /** 布局：unified 单栏 / split 双栏。 */
  variant: 'unified' | 'split';
  language: string;
  onRowMouseDown: (e: React.MouseEvent, pos: DiffPos) => void;
  onRowMouseEnter: (pos: DiffPos) => void;
  onClickLine: (hunkIdx: number, keyLineIdx: number) => void;
  onToggleSection: (hunkIdx: number, keyLineIdx: number) => void;
}

/**
 * 渲染一段被展开的 context 行（单段全文），unified/split 共用一份实现。
 * `sourceLineIdx` 定位折叠区间（hunk.lines 索引）；交互 key 统一使用
 * `keyLineIdx`（与各表格自己的选区 key 语义一致）。
 */
const ExpandedSectionRows: React.FC<ExpandedSectionRowsProps> = ({
  hunk,
  hunkIdx,
  sourceLineIdx,
  keyLineIdx,
  fullHunks,
  variant,
  language,
  onRowMouseDown,
  onRowMouseEnter,
  onClickLine,
  onToggleSection,
}) => {
  if (!fullHunks) return null;
  const range = collapsedSectionRanges(hunk).find((r) => r.index === sourceLineIdx);
  if (!range) return null;
  const fullHunk = findFullHunkForOldLine(fullHunks, range.oldStart);
  if (!fullHunk) return null;
  const lines = spliceFullHunkSection(fullHunk, range);
  const dragPos = { hunk: hunkIdx, line: keyLineIdx };
  const isSplit = variant === 'split';

  return (
    <React.Fragment key={`${hunkIdx}-${keyLineIdx}-expanded`}>
      {lines.map((line, i) => {
        const view = renderHighlightedHtml(line.Context ?? '', language);
        const numClass = isSplit
          ? 'line-number split-linenum context cursor-pointer hover:bg-bg-hover'
          : 'w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover';
        return (
          <tr
            key={`${hunkIdx}-${keyLineIdx}-${i}`}
            className={isSplit ? 'diff-line split-row' : 'diff-line border-none'}
          >
            <td
              className={numClass}
              onMouseDown={(e) => onRowMouseDown(e, dragPos)}
              onMouseEnter={() => onRowMouseEnter(dragPos)}
              onClick={() => onClickLine(hunkIdx, keyLineIdx)}
            >
              {range.oldStart + i}
            </td>
            {isSplit ? (
              <td
                className="line-content split-cell whitespace-pre context"
                dangerouslySetInnerHTML={{ __html: view }}
              />
            ) : (
              <td
                className="w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover"
                onMouseDown={(e) => onRowMouseDown(e, dragPos)}
                onMouseEnter={() => onRowMouseEnter(dragPos)}
                onClick={() => onClickLine(hunkIdx, keyLineIdx)}
              >
                {range.newStart + i}
              </td>
            )}
            {isSplit ? (
              <td
                className="line-number new split-linenum context cursor-pointer hover:bg-bg-hover"
                onMouseDown={(e) => onRowMouseDown(e, dragPos)}
                onMouseEnter={() => onRowMouseEnter(dragPos)}
                onClick={() => onClickLine(hunkIdx, keyLineIdx)}
              >
                {range.newStart + i}
              </td>
            ) : (
              <td className="w-5 text-center select-none"> </td>
            )}
            <td
              className={
                isSplit
                  ? 'line-content split-cell whitespace-pre context'
                  : 'line-content whitespace-pre'
              }
              onMouseDown={(e) => onRowMouseDown(e, dragPos)}
              onMouseEnter={() => onRowMouseEnter(dragPos)}
              onClick={() => onClickLine(hunkIdx, keyLineIdx)}
              dangerouslySetInnerHTML={{ __html: view }}
            />
          </tr>
        );
      })}
      <tr
        className="bg-bg-secondary/60 text-text-muted text-center italic"
        onMouseDown={(e) => onRowMouseDown(e, dragPos)}
        onMouseEnter={() => onRowMouseEnter(dragPos)}
      >
        <td colSpan={4} className="py-1 px-2 text-[12px]">
          <button
            type="button"
            className="bg-transparent border-none text-inherit italic cursor-pointer hover:text-text-primary"
            onClick={() => onToggleSection(hunkIdx, keyLineIdx)}
            title="Collapse section"
          >
            ─ Collapse section ─
          </button>
        </td>
      </tr>
    </React.Fragment>
  );
};

export default React.memo(ExpandedSectionRows);
