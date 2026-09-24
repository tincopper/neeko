import type { DiffHunk, DiffLine, DiffResult, FileLineChange, WordRange } from '@/shared/types/git';

/**
 * 从 `get_file_diff` 结果推导编辑器行级变更（方案 A：零后端）。
 *
 * 语义契约（与 DiffTable/buildSplitRows 行号规则对齐）：
 * - new 侧行号从 `hunk.new_start` 起：Context/Added 占 1 行，Removed 不占；
 * - `Collapsed("N unmodified lines")` 按 N 推进 new 行号（隐藏行仍存在于文档）；
 * - 同 hunk 内连续 Removed 块后紧跟 Added 块 → 索引配对：双方都在 = modified
 *   （附词级 WordRange），Added 多出 = added，Removed 多出不产条目；
 * - 孤立 Added 块 = added；纯 Removed / 仅 Context = 无条目；
 * - 输出按 line 升序、同行去重（后者覆盖）；truncated 时返回已得部分。
 *
 * 纯函数，无 IPC；拉取 + 推导的 IPC  seam 在 `../api/fileLineChange`。
 */
export function deriveFileLineChanges(diff: DiffResult): FileLineChange[] {
  const byLine = new Map<number, FileLineChange>();
  for (const hunk of diff.hunks ?? []) {
    collectHunk(hunk, byLine);
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

function collectHunk(hunk: DiffHunk, out: Map<number, FileLineChange>): void {
  let newLine = hunk.new_start;
  const lines = hunk.lines ?? [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isContext(line)) {
      newLine += 1;
      i += 1;
      continue;
    }
    if (isCollapsed(line)) {
      newLine += parseCollapsedCount(line.Collapsed);
      i += 1;
      continue;
    }
    if (isRemoved(line)) {
      const removed: string[] = [];
      while (i < lines.length && isRemoved(lines[i])) {
        removed.push(contentOf(lines[i++]));
      }
      const added: string[] = [];
      while (i < lines.length && isAdded(lines[i])) {
        added.push(contentOf(lines[i++]));
      }
      const paired = Math.min(removed.length, added.length);
      for (let j = 0; j < paired; j++) {
        out.set(newLine, {
          line: newLine,
          kind: 'modified',
          words: buildWordRanges(removed[j], added[j]),
        });
        newLine += 1;
      }
      for (let j = paired; j < added.length; j++) {
        out.set(newLine, { line: newLine, kind: 'added' });
        newLine += 1;
      }
      // removed 多出的行：编辑器无行位，丢弃
      continue;
    }
    if (isAdded(line)) {
      out.set(newLine, { line: newLine, kind: 'added' });
      newLine += 1;
      i += 1;
      continue;
    }
    // 未知行类型：跳过不推进（防御）
    i += 1;
  }
}

function isContext(line: DiffLine): line is { Context: string } {
  return 'Context' in line;
}

function isAdded(line: DiffLine): line is { Added: string } {
  return 'Added' in line;
}

function isRemoved(line: DiffLine): line is { Removed: string } {
  return 'Removed' in line;
}

function isCollapsed(line: DiffLine): line is { Collapsed: string } {
  return 'Collapsed' in line;
}

function contentOf(line: DiffLine): string {
  if ('Added' in line) return line.Added;
  if ('Removed' in line) return line.Removed;
  if ('Context' in line) return line.Context;
  return '';
}

/** 解析 `N unmodified lines` 折叠占位文本中的行数（与 diffViewUtils 同语义）。 */
function parseCollapsedCount(text: string): number {
  const m = text.match(/^(\d+)\s+unmodified lines?$/);
  return m ? Number(m[1]) : 0;
}

/**
 * 词级差分：返回 newText 中相对 oldText 的新增/替换片段区间（UTF-16 偏移）。
 * 自带分词 + LCS，不依赖 components/diff 内部实现（层级：utils 不上探组件）。
 */
export function buildWordRanges(oldText: string, newText: string): WordRange[] {
  if (oldText === newText) return [];
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const matchedNew = matchedNewFlags(oldTokens, newTokens);

  const ranges: WordRange[] = [];
  let offset = 0;
  let pendingFrom = -1;
  for (let ni = 0; ni < newTokens.length; ni++) {
    const len = newTokens[ni].length;
    if (!matchedNew[ni]) {
      if (pendingFrom < 0) pendingFrom = offset;
      offset += len;
      continue;
    }
    if (pendingFrom >= 0) {
      if (offset > pendingFrom) ranges.push({ from: pendingFrom, to: offset });
      pendingFrom = -1;
    }
    offset += len;
  }
  if (pendingFrom >= 0 && offset > pendingFrom) {
    ranges.push({ from: pendingFrom, to: offset });
  }
  return ranges;
}

/** 新侧 token 是否落在一条 LCS 匹配对上（未匹配 = 新增/替换片段）。 */
function matchedNewFlags(a: string[], b: string[]): boolean[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matched = new Array<boolean>(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matched[j - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return matched;
}

/** 与 DiffView 分词对齐：`\w+`/CJK 连续段 | 其余单字符。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-zA-Z0-9_一-鿿]/.test(ch)) {
      current += ch;
    } else {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(ch);
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
