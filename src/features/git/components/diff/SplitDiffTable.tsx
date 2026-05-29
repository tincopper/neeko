import React from "react";
import { cn } from "../../../../utils/cn";
import { buildSplitRows, computeWordDiff } from "./diffAlgorithm";
import { renderHighlightedHtml, renderWordDiffHtml } from "./highlight";
import type { DiffResult } from "./types";

interface SplitDiffTableProps {
  diffResult: DiffResult;
  language: string;
}

const SplitDiffTable: React.FC<SplitDiffTableProps> = ({ diffResult, language }) => {
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
              if (row.type === "hunk-header") {
                return (
                  <tr
                    key={`${hunkIndex}-${rowIndex}`}
                    className="bg-bg-tertiary text-accent-blue font-medium"
                  >
                    <td colSpan={4} className="py-1 px-2">
                      {row.hunkHeader}
                    </td>
                  </tr>
                );
              }

              const isChanged =
                row.type === "change" &&
                (row.oldType === "removed" || row.newType === "added");
              let blockId: string | undefined;
              if (isChanged && !inBlock) {
                blockId = `cb-${globalBlockIdx++}`;
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

              return (
                <tr
                  key={`${hunkIndex}-${rowIndex}`}
                  id={blockId}
                  className="diff-line split-row"
                >
                  <td className={cn("line-number old split-linenum", row.oldType)}>
                    {row.oldLineNum ?? ""}
                  </td>
                  <td
                    className={cn("line-content split-cell", row.oldType)}
                    dangerouslySetInnerHTML={{
                      __html:
                        oldCellHtml ||
                        (row.oldType === "empty" ? "" : row.oldContent || ""),
                    }}
                  />
                  <td className={cn("line-number new split-linenum", row.newType)}>
                    {row.newLineNum ?? ""}
                  </td>
                  <td
                    className={cn("line-content split-cell", row.newType)}
                    dangerouslySetInnerHTML={{
                      __html:
                        newCellHtml ||
                        (row.newType === "empty" ? "" : row.newContent || ""),
                    }}
                  />
                </tr>
              );
            });
          });
        })()}
      </tbody>
    </table>
  );
};

export default React.memo(SplitDiffTable);
