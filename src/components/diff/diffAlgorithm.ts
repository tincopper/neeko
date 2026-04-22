import type { DiffHunk, DiffLine, SplitRow } from "./types";

export interface WordDiffPart {
  value: string;
  type: "equal" | "added" | "removed";
}

export function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-zA-Z0-9_\u4e00-\u9fff]/.test(ch)) {
      current += ch;
    } else {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(ch);
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

export function computeLCS(a: string[], b: string[]): boolean[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: boolean[][] = Array.from({ length: m }, () =>
    new Array(n).fill(false),
  );
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs[i - 1][j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return lcs;
}

export function computeWordDiff(
  oldText: string,
  newText: string,
): { oldParts: WordDiffPart[]; newParts: WordDiffPart[] } {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const lcs = computeLCS(oldTokens, newTokens);
  const oldParts: WordDiffPart[] = [];
  const newParts: WordDiffPart[] = [];

  let oi = 0;
  let ni = 0;

  while (oi < oldTokens.length || ni < newTokens.length) {
    if (oi < oldTokens.length && ni < newTokens.length && lcs[oi][ni]) {
      oldParts.push({ value: oldTokens[oi], type: "equal" });
      newParts.push({ value: newTokens[ni], type: "equal" });
      oi++;
      ni++;
    } else {
      let removedChunk = "";
      while (
        oi < oldTokens.length &&
        (ni >= newTokens.length || !lcs[oi][ni])
      ) {
        removedChunk += oldTokens[oi];
        oi++;
      }
      if (removedChunk) {
        oldParts.push({ value: removedChunk, type: "removed" });
      }

      let addedChunk = "";
      while (
        ni < newTokens.length &&
        (oi >= oldTokens.length || !lcs[oi][ni])
      ) {
        addedChunk += newTokens[ni];
        ni++;
      }
      if (addedChunk) {
        newParts.push({ value: addedChunk, type: "added" });
      }
    }
  }

  return { oldParts, newParts };
}

function getLineType(line: DiffLine): "added" | "removed" | "context" {
  if (line.Added !== undefined) {
    return "added";
  }
  if (line.Removed !== undefined) {
    return "removed";
  }
  return "context";
}

function getLineContent(line: DiffLine): string {
  return line.Added ?? line.Removed ?? line.Context ?? "";
}

export function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];

  rows.push({
    type: "hunk-header",
    hunkHeader: `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`,
  });

  let i = 0;
  let oldNum = hunk.old_start;
  let newNum = hunk.new_start;

  while (i < hunk.lines.length) {
    const line = hunk.lines[i];
    const type = getLineType(line);

    if (type === "context") {
      const content = getLineContent(line);
      rows.push({
        type: "context",
        oldLineNum: oldNum,
        newLineNum: newNum,
        oldContent: content,
        newContent: content,
        oldType: "context",
        newType: "context",
      });
      oldNum++;
      newNum++;
      i++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];

      while (i < hunk.lines.length && getLineType(hunk.lines[i]) === "removed") {
        removed.push(hunk.lines[i++]);
      }
      while (i < hunk.lines.length && getLineType(hunk.lines[i]) === "added") {
        added.push(hunk.lines[i++]);
      }

      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        const r = removed[j];
        const a = added[j];
        rows.push({
          type: "change",
          oldLineNum: r ? oldNum : undefined,
          newLineNum: a ? newNum : undefined,
          oldContent: r ? getLineContent(r) : undefined,
          newContent: a ? getLineContent(a) : undefined,
          oldType: r ? "removed" : "empty",
          newType: a ? "added" : "empty",
        });
        if (r) {
          oldNum++;
        }
        if (a) {
          newNum++;
        }
      }
    }
  }

  return rows;
}
