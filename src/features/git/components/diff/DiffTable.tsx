import React, { useMemo } from 'react';

import { cn } from '@/lib/utils';

import { computeWordDiff } from './diffAlgorithm';
import { lastSelectedKeyOf, type SelectionMode } from './diffViewUtils';
import ExpandedSectionRows from './ExpandedSectionRows';
import { renderHighlightedHtml, renderWordDiffHtml } from './highlight';
import type { DiffHunk, DiffResult } from './types';
import { getLineContent, getLineType } from './useDiffData';
import { useDiffDragSelect } from './useDiffDragSelect';

interface DiffTableProps {
  diffResult: DiffResult;
  language: string;
  /** Triggers re-render after async language registration completes */
  languageReady?: boolean;
  selectedLines?: Set<string>;
  onToggleLine?: (blockIdx: number, lineIdx: number) => void;
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
  /** 已展开的折叠段（key 为 `hunkIdx:lineIdx`）。 */
  expandedSections?: Set<string>;
  /** 点击折叠占位行切换单段展开。 */
  onToggleSection?: (hunkIdx: number, lineIdx: number) => void;
  /** 选中块末尾的浮动工具条内容（跨列行渲染，随选中行滚动）。 */
  selectionActionBar?: () => React.ReactNode;
}

const DiffTable: React.FC<DiffTableProps> = ({
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
  // unified 模式下选区 key 与 hunk.lines 一一对应
  const hunkLineCounts = useMemo(() => diffResult.hunks.map((h) => h.lines.length), [diffResult]);
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
    // 不被外层 DiffFileCard 的 overflow-hidden 裁剪
    <div className="overflow-x-auto">
      <table
        className="w-max min-w-full border-collapse font-mono"
        style={{ fontSize: 'var(--font-size)' }}
      >
        <tbody>
          {(() => {
            let globalBlockIdx = 0;
            return diffResult.hunks.map((hunk, hunkIndex) => {
              let oldNum = hunk.old_start;
              let newNum = hunk.new_start;
              let inBlock = false;

              return (
                <React.Fragment key={hunkIndex}>
                  {/* Hunk @@ headers omitted — line numbers already convey location. */}
                  {hunk.lines.map((line, lineIndex) => {
                    const lineType = getLineType(line);
                    const content = getLineContent(line);
                    const curOld = oldNum;
                    const curNew = newNum;

                    if (lineType === 'collapsed') {
                      const sectionKey = `${hunkIndex}:${lineIndex}`;
                      if (expandedSections?.has(sectionKey)) {
                        return (
                          <ExpandedSectionRows
                            key={`${hunkIndex}-${lineIndex}-expanded`}
                            hunk={hunk}
                            hunkIdx={hunkIndex}
                            sourceLineIdx={lineIndex}
                            keyLineIdx={lineIndex}
                            fullHunks={fullHunks}
                            variant="unified"
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
                          key={`${hunkIndex}-${lineIndex}`}
                          className="bg-bg-secondary/60 text-text-muted text-center italic cursor-pointer hover:bg-bg-hover"
                          onMouseDown={(e) =>
                            onRowMouseDown(e, { hunk: hunkIndex, line: lineIndex })
                          }
                          onMouseEnter={() => onRowMouseEnter({ hunk: hunkIndex, line: lineIndex })}
                          onClick={() => onToggleSection?.(hunkIndex, lineIndex)}
                          title="Expand section"
                        >
                          <td colSpan={3} className="py-1 px-2 text-[12px]">
                            {content}
                          </td>
                        </tr>
                      );
                    }

                    if (lineType !== 'added') {
                      oldNum++;
                    }
                    if (lineType !== 'removed') {
                      newNum++;
                    }

                    const isChanged = lineType === 'added' || lineType === 'removed';
                    let blockId: string | undefined;
                    if (isChanged && !inBlock) {
                      blockId = `${blockIdPrefix}-${globalBlockIdx++}`;
                      inBlock = true;
                    } else if (!isChanged) {
                      inBlock = false;
                    }

                    let view = renderHighlightedHtml(content, language);
                    if (lineType === 'removed') {
                      const nextLine = hunk.lines[lineIndex + 1];
                      if (nextLine?.Added !== undefined) {
                        const { oldParts } = computeWordDiff(content, nextLine.Added);
                        view = renderWordDiffHtml(oldParts, 'old', language);
                      }
                    } else if (lineType === 'added') {
                      const prevLine = hunk.lines[lineIndex - 1];
                      if (prevLine?.Removed !== undefined) {
                        const { newParts } = computeWordDiff(prevLine.Removed, content);
                        view = renderWordDiffHtml(newParts, 'new', language);
                      }
                    }

                    const lineKey = `${hunkIndex}:${lineIndex}`;
                    const isSelected =
                      (selectedLines?.has(lineKey) ?? false) ||
                      (dragPreview?.has(lineKey) ?? false);
                    // 选中块末尾：仅在全局最后一个选中行渲染 inline 输入条
                    const isSelectionEnd = lineKey === lastSelectedKey;
                    const canComment =
                      onCommentLine && (lineType === 'added' || lineType === 'context');
                    const commentCount = commentCounts?.get(curNew) ?? 0;
                    const utils = renderCommentArea?.(curNew);

                    return (
                      <React.Fragment key={`${hunkIndex}-${lineIndex}`}>
                        <tr
                          id={blockId}
                          className={cn(
                            'diff-line border-none',
                            lineType === 'added' && 'bg-diff-added',
                            lineType === 'removed' && 'bg-diff-removed',
                            isSelected && 'diff-line-selected',
                          )}
                          onMouseDown={(e) =>
                            onRowMouseDown(e, { hunk: hunkIndex, line: lineIndex })
                          }
                          onMouseEnter={() => onRowMouseEnter({ hunk: hunkIndex, line: lineIndex })}
                        >
                          <td
                            className={cn(
                              'w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover relative group',
                              isSelected && 'text-accent-blue',
                            )}
                            onClick={() => handleRowClick(hunkIndex, lineIndex)}
                            title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                          >
                            {lineType !== 'added' ? curOld : ''}
                            {canComment && (
                              <button
                                className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[11px] font-bold text-text-muted hover:text-accent-blue hover:bg-bg-hover rounded opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCommentLine(curNew);
                                }}
                                title="Add a comment on this line"
                              >
                                +
                              </button>
                            )}
                          </td>
                          <td
                            className={cn(
                              'w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover relative',
                              isSelected && 'text-accent-blue',
                            )}
                            onClick={() => handleRowClick(hunkIndex, lineIndex)}
                            title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                          >
                            {lineType !== 'removed' ? curNew : ''}
                            {commentCount > 0 && (
                              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-accent-blue font-bold">
                                {commentCount}
                              </span>
                            )}
                          </td>
                          <td
                            className="line-content whitespace-pre"
                            onClick={() => handleRowClick(hunkIndex, lineIndex)}
                            title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                            dangerouslySetInnerHTML={{ __html: view }}
                          />
                        </tr>
                        {utils && (
                          <tr>
                            <td
                              colSpan={3}
                              className="py-2 px-4 bg-bg-secondary border-t border-border"
                            >
                              {utils}
                            </td>
                          </tr>
                        )}
                        {isSelectionEnd && selectionActionBar ? (
                          <tr>
                            <td colSpan={3} className="p-0">
                              {selectionActionBar()}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            });
          })()}
        </tbody>
      </table>
    </div>
  );
};

export default React.memo(DiffTable);
