import type { DiffHunk, DiffLine, SplitRow } from './types';

/**
 * Diff 行装配（纯函数，仅行级）。
 *
 * 刻意不做行内词级差分 —— 变更标记只走行级底色（`--diff-added` / `--diff-removed`），
 * 行内片段不再叠底。口径与判定见 `.trellis/spec/frontend/design-tokens.md`「变更高亮」，
 * 机器判据在 `src/styles/__tests__/changeHighlightCss.ts`。
 */

function getLineType(line: DiffLine): 'added' | 'removed' | 'context' {
  if (line.Added !== undefined) {
    return 'added';
  }
  if (line.Removed !== undefined) {
    return 'removed';
  }
  return 'context';
}

function getLineContent(line: DiffLine): string {
  return line.Added ?? line.Removed ?? line.Context ?? '';
}

export function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];

  rows.push({
    type: 'hunk-header',
    hunkHeader: `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`,
  });

  let i = 0;
  let oldNum = hunk.old_start;
  let newNum = hunk.new_start;

  while (i < hunk.lines.length) {
    const line = hunk.lines[i];

    if (line.Collapsed !== undefined) {
      // 折叠段占位行：保留在 split 视图中，供单段展开
      rows.push({
        type: 'collapsed',
        collapsedText: line.Collapsed,
        oldLineNum: oldNum,
        newLineNum: newNum,
        sourceIndex: i,
      });
      i++;
      continue;
    }

    const type = getLineType(line);

    if (type === 'context') {
      const content = getLineContent(line);
      rows.push({
        type: 'context',
        oldLineNum: oldNum,
        newLineNum: newNum,
        oldContent: content,
        newContent: content,
        oldType: 'context',
        newType: 'context',
      });
      oldNum++;
      newNum++;
      i++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];

      while (i < hunk.lines.length && getLineType(hunk.lines[i]) === 'removed') {
        removed.push(hunk.lines[i++]);
      }
      while (i < hunk.lines.length && getLineType(hunk.lines[i]) === 'added') {
        added.push(hunk.lines[i++]);
      }

      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        const r = removed[j];
        const a = added[j];
        rows.push({
          type: 'change',
          oldLineNum: r ? oldNum : undefined,
          newLineNum: a ? newNum : undefined,
          oldContent: r ? getLineContent(r) : undefined,
          newContent: a ? getLineContent(a) : undefined,
          oldType: r ? 'removed' : 'empty',
          newType: a ? 'added' : 'empty',
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
