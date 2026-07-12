import React from "react";
import { cn } from '@/lib/utils';
import { computeWordDiff } from "./diffAlgorithm";
import { renderHighlightedHtml, renderWordDiffHtml } from "./highlight";
import type { DiffResult } from "./types";
import { getLineContent, getLineType } from "./useDiffData";

interface DiffTableProps {
  diffResult: DiffResult;
  language: string;
  selectedLines?: Set<string>;
  onToggleLine?: (blockIdx: number, lineIdx: number) => void;
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
                <tr
                  className="bg-bg-tertiary text-accent-blue font-medium cursor-pointer hover:bg-bg-hover"
                  onClick={() => onToggleLine?.(hunkIndex, -1)}
                >
                  <td colSpan={4} className="py-1 px-2">
                    @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},
                    {hunk.new_lines} @@
                  </td>
                </tr>

                {hunk.lines.map((line, lineIndex) => {
                  const lineType = getLineType(line);
                  const content = getLineContent(line);
                  const curOld = oldNum;
                  const curNew = newNum;

                  if (lineType === "collapsed") {
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

                  if (lineType !== "added") {
                    oldNum++;
                  }
                  if (lineType !== "removed") {
                    newNum++;
                  }

                  const isChanged =
                    lineType === "added" || lineType === "removed";
                  let blockId: string | undefined;
                  if (isChanged && !inBlock) {
                    blockId = `cb-${globalBlockIdx++}`;
                    inBlock = true;
                  } else if (!isChanged) {
                    inBlock = false;
                  }

                  let cellHtml = renderHighlightedHtml(content, language);
                  if (lineType === "removed") {
                    const nextLine = hunk.lines[lineIndex + 1];
                    if (nextLine?.Added !== undefined) {
                      const { oldParts } = computeWordDiff(content, nextLine.Added);
                      cellHtml = renderWordDiffHtml(oldParts, "old", language);
                    }
                  } else if (lineType === "added") {
                    const prevLine = hunk.lines[lineIndex - 1];
                    if (prevLine?.Removed !== undefined) {
                      const { newParts } = computeWordDiff(prevLine.Removed, content);
                      cellHtml = renderWordDiffHtml(newParts, "new", language);
                    }
                  }

                  const lineKey = `${hunkIndex}:${lineIndex}`;
                  const isSelected = selectedLines?.has(lineKey) ?? false;
                  const canComment = onCommentLine && (lineType === "added" || lineType === "context");
                  const commentCount = commentCounts?.get(curNew) ?? 0;
                  const commentArea = renderCommentArea?.(curNew);

                  return (
                    <React.Fragment key={`${hunkIndex}-${lineIndex}`}>
                      <tr
                        id={blockId}
                        className={cn(
                          "border-none",
                          lineType === "added" && "bg-diff-added",
                          lineType === "removed" && "bg-diff-removed",
                          isSelected && "bg-blue-500/10",
                          isSelected && (lineType === "added" && "bg-diff-added-selected"),
                          isSelected && (lineType === "removed" && "bg-diff-removed-selected"),
                        )}
                      >
                        <td
                          className="w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover relative group"
                          onClick={() => onToggleLine?.(hunkIndex, lineIndex)}
                        >
                          {lineType !== "added" ? curOld : ""}
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
                          className="w-[40px] text-right text-text-muted select-none cursor-pointer hover:bg-bg-hover relative"
                          onClick={() => onToggleLine?.(hunkIndex, lineIndex)}
                        >
                          {lineType !== "removed" ? curNew : ""}
                          {commentCount > 0 && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-accent-blue font-bold">
                              {commentCount}
                            </span>
                          )}
                        </td>
                        <td className="w-5 text-center select-none">
                          {lineType === "added"
                            ? "+"
                            : lineType === "removed"
                              ? "-"
                              : " "}
                        </td>
                        <td
                          className="whitespace-pre-wrap break-all"
                          dangerouslySetInnerHTML={{ __html: cellHtml }}
                        />
                      </tr>
                      {commentArea && (
                        <tr>
                          <td colSpan={4} className="py-2 px-4 bg-bg-secondary border-t border-border">
                            {commentArea}
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
