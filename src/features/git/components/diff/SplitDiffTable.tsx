import React, { useMemo } from 'react';

import { cn } from '@/lib/utils';

import { buildSplitRows, computeWordDiff } from './diffAlgorithm';
import { lastSelectedKeyOf, lineNumColumnWidth, type SelectionMode } from './diffViewUtils';
import ExpandedSectionRows from './ExpandedSectionRows';
import { renderHighlightedHtml, renderWordDiffHtml } from './highlight';
import type { DiffHunk, DiffResult } from './types';
import { useDiffDragSelect } from './useDiffDragSelect';

interface SplitDiffTableProps {
  diffResult: DiffResult;
  language: string;
  /** Triggers re-render after async language registration completes */
  languageReady?: boolean;
  selectedLines?: Set<string>;
  onToggleLine?: (hunkIdx: number, lineIdx: number) => void;
  /** 拖拽结束时提交选区（AI review 多行选择）。 */
  onDragCommit?: (keys: Set<string>, mode: SelectionMode) => void;
  /** Prefix for change-block element ids (default `cb`). Combined mode scopes per file. */
  blockIdPrefix?: string;
  // Optional comment support (for PR review)
  onCommentLine?: (lineNum: number) => void;
  renderCommentArea?: (lineNum: number) => React.ReactNode;
  commentCounts?: Map<number, number>;
  /** 全量（未折叠）diff，用于单段展开。 */
  fullHunks?: DiffHunk[];
  /** 已展开的折叠段（key 为 `hunkIdx:lineIdx`，lineIdx 为源 hunk.lines 索引）。 */
  expandedSections?: Set<string>;
  /** 点击折叠占位行切换单段展开。 */
  onToggleSection?: (hunkIdx: number, lineIdx: number) => void;
  /** 选中块末尾的浮动工具条内容（跨列行渲染，随选中行滚动）。 */
  selectionActionBar?: () => React.ReactNode;
}

const SplitDiffTable: React.FC<SplitDiffTableProps> = ({
  diffResult,
  language,
  selectedLines,
  onToggleLine,
  onDragCommit,
  blockIdPrefix = 'cb',
  onCommentLine,
  renderCommentArea,
  commentCounts,
  fullHunks,
  expandedSections,
  onToggleSection,
  selectionActionBar,
}) => {
  // split 模式下选区 key 与 buildSplitRows 产出的行一一对应
  const hunkLineCounts = useMemo(
    () => diffResult.hunks.map((h) => buildSplitRows(h).length),
    [diffResult],
  );
  // 行号列宽度随最大行号位数自适应（ch = 等宽字符宽，+6px 容纳选中指示条/呼吸）
  const linenumWidth = useMemo(() => lineNumColumnWidth(diffResult.hunks), [diffResult]);
  const tableStyle = useMemo(
    () =>
      ({
        fontSize: 'var(--font-size)',
        '--linenum-w': linenumWidth,
      }) as React.CSSProperties,
    [linenumWidth],
  );
  const { dragPreview, onRowMouseDown, onRowMouseEnter, shouldSuppressClick } = useDiffDragSelect(
    hunkLineCounts,
    onDragCommit,
  );

  const handleRowClick = (hunkIdx: number, lineIdx: number) => {
    if (shouldSuppressClick()) return;
    onToggleLine?.(hunkIdx, lineIdx);
  };

  // 全局最后一个选中行的 key（仅在该行末尾渲染 inline 输入条，避免多段选区出现多个输入条）
  const lastSelectedKey = useMemo(() => lastSelectedKeyOf(selectedLines), [selectedLines]);

  return (
    // overflow-x-auto 紧贴表格：长行撑宽表格后出现水平滚动条，
    // 不被外层 DiffFileCard 的 overflow-hidden 裁剪；单一 table 内左右两侧同步滚动
    <div className="overflow-x-auto">
      <table
        className="w-max min-w-full border-collapse font-mono diff-table-split"
        style={tableStyle}
      >
        <colgroup>
          <col className="col-linenum" />
          <col className="col-code" />
          <col className="col-linenum" />
          <col className="col-code" />
        </colgroup>
        <tbody>
          {(() => {
            let globalBlockIdx = 0;
            return diffResult.hunks.map((hunk, hunkIndex) => {
              let inBlock = false;
              return buildSplitRows(hunk).map((row, rowIndex) => {
                // Skip @@ hunk headers — split line numbers already show position.
                if (row.type === 'hunk-header') {
                  return null;
                }

                if (row.type === 'collapsed') {
                  // 选区/展开 key 统一使用 rowIndex（与普通行一致）；
                  // sourceIndex（hunk.lines 索引）仅用于内部折叠区间定位
                  const sourceLineIdx = row.sourceIndex ?? rowIndex;
                  const sectionKey = `${hunkIndex}:${rowIndex}`;
                  if (expandedSections?.has(sectionKey)) {
                    return (
                      <ExpandedSectionRows
                        key={`${hunkIndex}-${rowIndex}-expanded`}
                        hunk={hunk}
                        hunkIdx={hunkIndex}
                        sourceLineIdx={sourceLineIdx}
                        keyLineIdx={rowIndex}
                        fullHunks={fullHunks}
                        variant="split"
                        linenumWidth={linenumWidth}
                        language={language}
                        onRowMouseDown={onRowMouseDown}
                        onRowMouseEnter={onRowMouseEnter}
                        onClickLine={handleRowClick}
                        onToggleSection={(h, l) => onToggleSection?.(h, l)}
                      />
                    );
                  }
                  return (
                    <tr
                      key={`${hunkIndex}-${rowIndex}`}
                      className="bg-bg-secondary/60 text-text-muted text-center italic cursor-pointer hover:bg-bg-hover"
                      onMouseDown={(e) => onRowMouseDown(e, { hunk: hunkIndex, line: rowIndex })}
                      onMouseEnter={() => onRowMouseEnter({ hunk: hunkIndex, line: rowIndex })}
                      onClick={() => onToggleSection?.(hunkIndex, rowIndex)}
                      title="Expand section"
                    >
                      <td colSpan={4} className="py-1 px-2 text-[12px]">
                        {row.collapsedText}
                      </td>
                    </tr>
                  );
                }

                const isChanged =
                  row.type === 'change' && (row.oldType === 'removed' || row.newType === 'added');
                let blockId: string | undefined;
                if (isChanged && !inBlock) {
                  blockId = `${blockIdPrefix}-${globalBlockIdx++}`;
                  inBlock = true;
                } else if (!isChanged) {
                  inBlock = false;
                }

                let oldCellHtml = '';
                let newCellHtml = '';

                if (row.type === 'context') {
                  const view = renderHighlightedHtml(row.oldContent || '', language);
                  oldCellHtml = view;
                  newCellHtml = view;
                } else if (row.type === 'change') {
                  if (
                    row.oldType === 'removed' &&
                    row.newType === 'added' &&
                    row.oldContent &&
                    row.newContent
                  ) {
                    const { oldParts, newParts } = computeWordDiff(row.oldContent, row.newContent);
                    oldCellHtml = renderWordDiffHtml(oldParts, 'old', language);
                    newCellHtml = renderWordDiffHtml(newParts, 'new', language);
                  } else if (row.oldType === 'removed' && row.oldContent) {
                    oldCellHtml = renderHighlightedHtml(row.oldContent, language);
                  } else if (row.newType === 'added' && row.newContent) {
                    newCellHtml = renderHighlightedHtml(row.newContent, language);
                  }
                }

                const lineKey = `${hunkIndex}:${rowIndex}`;
                const isSelected =
                  (selectedLines?.has(lineKey) ?? false) || (dragPreview?.has(lineKey) ?? false);
                // 选中块末尾：仅在全局最后一个选中行渲染 inline 输入条
                const isSelectionEnd = lineKey === lastSelectedKey;
                const isRemoved = row.type === 'change' && row.oldType === 'removed';
                const isAdded = row.type === 'change' && row.newType === 'added';
                const newLineNum = row.newLineNum;
                const canComment = onCommentLine && row.newType === 'added';
                const commentCount = commentCounts?.get(newLineNum ?? 0) ?? 0;
                const utils = renderCommentArea?.(newLineNum ?? 0);

                return (
                  <React.Fragment key={`${hunkIndex}-${rowIndex}`}>
                    <tr
                      id={blockId}
                      className={cn('diff-line split-row', isSelected && 'diff-line-selected')}
                      onMouseDown={(e) => onRowMouseDown(e, { hunk: hunkIndex, line: rowIndex })}
                      onMouseEnter={() => onRowMouseEnter({ hunk: hunkIndex, line: rowIndex })}
                    >
                      <td
                        className={cn(
                          'line-number old split-linenum text-right',
                          row.oldType,
                          'cursor-pointer hover:bg-bg-hover',
                          isSelected && 'text-accent-blue font-semibold',
                        )}
                        onClick={() => handleRowClick(hunkIndex, rowIndex)}
                        title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                      >
                        {row.oldLineNum ?? ''}
                      </td>
                      <td
                        className={cn(
                          'line-content split-cell whitespace-pre pl-2',
                          row.oldType,
                          isSelected && isRemoved && 'bg-diff-removed',
                        )}
                        dangerouslySetInnerHTML={{
                          __html:
                            oldCellHtml || (row.oldType === 'empty' ? '' : row.oldContent || ''),
                        }}
                      />
                      <td
                        className={cn(
                          'line-number new split-linenum text-right',
                          row.newType,
                          'cursor-pointer hover:bg-bg-hover relative group',
                          isSelected && 'text-accent-blue font-semibold',
                        )}
                        onClick={() => handleRowClick(hunkIndex, rowIndex)}
                        title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                      >
                        {row.newLineNum ?? ''}
                        {canComment && (
                          <button
                            className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 flex items-center justify-center text-[11px] font-bold text-text-muted hover:text-accent-blue hover:bg-bg-hover rounded opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (newLineNum) onCommentLine(newLineNum);
                            }}
                            title="Add a comment on this line"
                          >
                            +
                          </button>
                        )}
                        {commentCount > 0 && (
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-accent-blue font-bold">
                            {commentCount}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'line-content split-cell whitespace-pre pl-2',
                          row.newType,
                          isSelected && isAdded && 'bg-diff-added',
                        )}
                        dangerouslySetInnerHTML={{
                          __html:
                            newCellHtml || (row.newType === 'empty' ? '' : row.newContent || ''),
                        }}
                      />
                    </tr>
                    {utils && (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-2 px-4 bg-bg-secondary border-t border-border"
                        >
                          {utils}
                        </td>
                      </tr>
                    )}
                    {isSelectionEnd && selectionActionBar ? (
                      <tr>
                        <td colSpan={4} className="p-0">
                          {selectionActionBar()}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              });
            });
          })()}
        </tbody>
      </table>
    </div>
  );
};

export default React.memo(SplitDiffTable);
