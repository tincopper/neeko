import React from "react";
import { cn } from "../../utils/cn";
import { computeWordDiff } from "./diffAlgorithm";
import { renderHighlightedHtml, renderWordDiffHtml } from "./highlight";
import type { DiffResult } from "./types";
import { getLineContent, getLineType } from "./useDiffData";

interface UnifiedDiffTableProps {
  diffResult: DiffResult;
  language: string;
}

const UnifiedDiffTable: React.FC<UnifiedDiffTableProps> = ({
  diffResult,
  language,
}) => {
  return (
    <table className="w-full border-collapse font-mono text-base">
      <tbody>
        {(() => {
          let globalBlockIdx = 0;
          return diffResult.hunks.map((hunk, hunkIndex) => {
            let oldNum = hunk.old_start;
            let newNum = hunk.new_start;
            let inBlock = false;

            return (
              <React.Fragment key={hunkIndex}>
                <tr className="bg-bg-tertiary text-accent-blue font-medium">
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

                  return (
                    <tr
                      key={`${hunkIndex}-${lineIndex}`}
                      id={blockId}
                      className={cn(
                        "border-none",
                        lineType === "added" && "bg-diff-added",
                        lineType === "removed" && "bg-diff-removed",
                      )}
                    >
                      <td className="w-[50px] text-right text-text-muted select-none">
                        {lineType !== "added" ? curOld : ""}
                      </td>
                      <td className="w-[50px] text-right text-text-muted select-none">
                        {lineType !== "removed" ? curNew : ""}
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

export default React.memo(UnifiedDiffTable);
