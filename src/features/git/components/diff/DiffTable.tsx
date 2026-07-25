import React from 'react';

import { cn } from '@/lib/utils';

import { computeWordDiff } from './diffAlgorithm';
import { renderHighlightedHtml, renderWordDiffHtml } from './highlight';
import type { DiffResult } from './types';
import { getLineContent, getLineType } from './useDiffData';

interface DiffTableProps {
  diffResult: DiffResult;
  language: string;
  selectedLines?: Set<string>;
  onToggleLine?: (blockIdx: number, lineIdx: number) => void;
  /** Prefix for change-block element ids (default `cb`). Combined mode scopes per file. */
  blockIdPrefix?: string;
  // Optional comment support (for PR review)
  onCommentLine?: (lineNum: number) => void;
  renderCommentArea?: (lineNum: number) => React.ReactNode;
  commentCounts?: Map<number, number>;
}

const DiffTable: React.FC<DiffTableProps> = ({
  diffResult,
  language,
  selectedLines,
  onToggleLine,
  blockIdPrefix = 'cb',
  onCommentLine,
  renderCommentArea,
  commentCounts,
}) => {
  return (
    <table className="w-full border-collapse font-mono" style={{ fontSize: 'var(--font-size)' }}>
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
                    return (
                      <tr
                        key={`${hunkIndex}-${lineIndex}`}
                        className="bg-bg-secondary/60 text-text-muted text-center italic"
                      >
                        <td colSpan={4} className="py-1 px-2 text-[12px]">
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
                  const isSelected = selectedLines?.has(lineKey) ?? false;
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
                      >
                        <td
                          className={cn(
                            'w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover relative group',
                            isSelected && 'text-accent-blue',
                          )}
                          onClick={() => onToggleLine?.(hunkIndex, lineIndex)}
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
                          onClick={() => onToggleLine?.(hunkIndex, lineIndex)}
                          title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                        >
                          {lineType !== 'removed' ? curNew : ''}
                          {commentCount > 0 && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-accent-blue font-bold">
                              {commentCount}
                            </span>
                          )}
                        </td>
                        <td className="w-5 text-center select-none">
                          {lineType === 'added' ? '+' : lineType === 'removed' ? '-' : ' '}
                        </td>
                        <td
                          className="whitespace-pre-wrap break-all cursor-pointer"
                          onClick={() => onToggleLine?.(hunkIndex, lineIndex)}
                          title={isSelected ? 'Deselect line' : 'Select line for AI review'}
                          dangerouslySetInnerHTML={{ __html: view }}
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
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          });
        })()}
      </tbody>
    </table>
  );
};

export default React.memo(DiffTable);
