import React from "react";
import { cn } from '@/lib/utils';
import { buildSplitRows, computeWordDiff } from "./diffAlgorithm";
import { renderHighlightedHtml, renderWordDiffHtml } from "./highlight";
import type { DiffResult } from "./types";

interface SplitDiffTableProps {
  diffResult: DiffResult;
  language: string;
  selectedLines?: Set<string>;
  onToggleLine?: (hunkIdx: number, lineIdx: number) => void;
  /** Prefix for change-block element ids (default `cb`). Combined mode scopes per file. */
  blockIdPrefix?: string;
  // Optional comment support (for PR review)
  onCommentLine?: (lineNum: number) => void;
  renderCommentArea?: (lineNum: number) => React.ReactNode;
  commentCounts?: Map<number, number>;
}

const SplitDiffTable: React.FC<SplitDiffTableProps> = ({
  diffResult,
  language,
  selectedLines,
  onToggleLine,
  blockIdPrefix = "cb",
  onCommentLine,
  renderCommentArea,
  commentCounts,
}) => {
  return (
    <table className="w-full border-collapse font-mono diff-table-split" style={{ fontSize: 'var(--font-size)' }}>
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
              if (row.type === "hunk-header") {
                return null;
              }

              const isChanged =
                row.type === "change" &&
                (row.oldType === "removed" || row.newType === "added");
              let blockId: string | undefined;
              if (isChanged && !inBlock) {
                blockId = `${blockIdPrefix}-${globalBlockIdx++}`;
                inBlock = true;
              } else if (!isChanged) {
                inBlock = false;
              }

              let oldCellHtml = "";
              let newCellHtml = "";

              if (row.type === "context") {
                const highlighted = renderHighlightedHtml(row.oldContent || "", language);
                oldCellHtml = highlighted;
                newCellHtml = highlighted;
              } else if (row.type === "change") {
                if (
                  row.oldType === "removed" &&
                  row.newType === "added" &&
                  row.oldContent &&
                  row.newContent
                ) {
                  const { oldParts, newParts } = computeWordDiff(
                    row.oldContent,
                    row.newContent,
                  );
                  oldCellHtml = renderWordDiffHtml(oldParts, "old", language);
                  newCellHtml = renderWordDiffHtml(newParts, "new", language);
                } else if (row.oldType === "removed" && row.oldContent) {
                  oldCellHtml = renderHighlightedHtml(row.oldContent, language);
                } else if (row.newType === "added" && row.newContent) {
                  newCellHtml = renderHighlightedHtml(row.newContent, language);
                }
              }

              const lineKey = `${hunkIndex}:${rowIndex}`;
              const isSelected = selectedLines?.has(lineKey) ?? false;
              const isRemoved = row.type === "change" && row.oldType === "removed";
              const isAdded = row.type === "change" && row.newType === "added";
              const newLineNum = row.newLineNum;
              const canComment = onCommentLine && row.newType === "added";
              const commentCount = commentCounts?.get(newLineNum ?? 0) ?? 0;
              const commentArea = renderCommentArea?.(newLineNum ?? 0);

              return (
                <React.Fragment key={`${hunkIndex}-${rowIndex}`}>
                  <tr
                    id={blockId}
                    className={cn(
                      "diff-line split-row",
                      isSelected && "diff-line-selected",
                    )}
                  >
                    <td
                      className={cn(
                        "line-number old split-linenum",
                        row.oldType,
                        "cursor-pointer hover:bg-bg-hover",
                        isSelected && "text-accent-blue font-semibold",
                      )}
                      onClick={() => onToggleLine?.(hunkIndex, rowIndex)}
                      title={isSelected ? "Deselect line" : "Select line for AI review"}
                    >
                      {row.oldLineNum ?? ""}
                    </td>
                    <td
                      className={cn(
                        "line-content split-cell",
                        row.oldType,
                        isSelected && isRemoved && "bg-diff-removed",
                      )}
                      dangerouslySetInnerHTML={{
                        __html:
                          oldCellHtml ||
                          (row.oldType === "empty" ? "" : row.oldContent || ""),
                      }}
                    />
                    <td
                      className={cn(
                        "line-number new split-linenum",
                        row.newType,
                        "cursor-pointer hover:bg-bg-hover relative group",
                        isSelected && "text-accent-blue font-semibold",
                      )}
                      onClick={() => onToggleLine?.(hunkIndex, rowIndex)}
                      title={isSelected ? "Deselect line" : "Select line for AI review"}
                    >
                      {row.newLineNum ?? ""}
                      {canComment && (
                        <button
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[11px] font-bold text-text-muted hover:text-accent-blue hover:bg-bg-hover rounded opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer"
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
                        "line-content split-cell",
                        row.newType,
                        isSelected && isAdded && "bg-diff-added",
                      )}
                      dangerouslySetInnerHTML={{
                        __html:
                          newCellHtml ||
                          (row.newType === "empty" ? "" : row.newContent || ""),
                      }}
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
            });
          });
        })()}
      </tbody>
    </table>
  );
};

export default React.memo(SplitDiffTable);
