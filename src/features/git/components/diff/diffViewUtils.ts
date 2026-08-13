import type { CommitFileChange, DiffHunk, DiffLine } from './types';

/** 自定义评审指令长度上限（SelectionActionBar / ReviewInstructionPopover 共用单一来源）。 */
export const REVIEW_INSTRUCTION_MAX = 2000;

/** Split a file path into basename + directory. */
export function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { name: filePath, dir: '' };
  return {
    name: normalized.slice(idx + 1) || filePath,
    dir: normalized.slice(0, idx),
  };
}

/** Stable DOM id for combined file sections (scrollToPath target). */
export function fileBlockId(filePath: string): string {
  return `fileblock-${filePath.replace(/[/\\]/g, '_')}`;
}

/** Map git status letter / word to a single badge letter. */
export function statusLetter(status: string): string {
  const s = status.trim();
  if (!s) return 'M';
  const upper = s.toUpperCase();
  if (upper === 'M' || upper.startsWith('MOD')) return 'M';
  if (upper === 'A' || upper.startsWith('ADD')) return 'A';
  if (upper === 'D' || upper.startsWith('DEL')) return 'D';
  if (upper === 'R' || upper.startsWith('REN')) return 'R';
  return upper[0] ?? 'M';
}

export function statusBadgeClass(letter: string): string {
  switch (letter) {
    case 'A':
      return 'text-accent-green bg-accent-green/15';
    case 'D':
      return 'text-accent-red bg-accent-red/15';
    case 'R':
      return 'text-accent-yellow bg-accent-yellow/15';
    case 'M':
    default:
      return 'text-accent-blue bg-accent-blue/15';
  }
}

export function sumFileStats(files: CommitFileChange[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/**
 * Default expanded paths for combined mode (PRD R2.4):
 * - ≤3 files: all expanded
 * - otherwise: only preferred (scrollToPath) or first file
 */
export function initialExpandedPaths(
  files: CommitFileChange[],
  preferredPath?: string | null,
): Set<string> {
  if (files.length === 0) return new Set();
  if (files.length <= 3) return new Set(files.map((f) => f.path));
  const preferred =
    preferredPath && files.some((f) => f.path === preferredPath) ? preferredPath : files[0].path;
  return new Set([preferred]);
}

export function indexOfPath(files: CommitFileChange[], path: string | null | undefined): number {
  if (!path) return -1;
  return files.findIndex((f) => f.path === path);
}

// ─── 拖拽选择区间 ────────────────────────────────────────────────────────────

export interface DiffPos {
  hunk: number;
  line: number;
}

export interface SelectionRange {
  start: DiffPos;
  end: DiffPos;
}

/** 将拖拽锚点/当前点规范化为线性顺序（hunk 升序，同 hunk 内 line 升序）。 */
export function computeSelectionRange(anchor: DiffPos, current: DiffPos): SelectionRange {
  const anchorAfter =
    anchor.hunk > current.hunk || (anchor.hunk === current.hunk && anchor.line > current.line);
  return anchorAfter ? { start: current, end: anchor } : { start: anchor, end: current };
}

/**
 * 生成区间 [start, end] 内所有行的选区 key（`hunk:line`）。
 * `hunkLineCounts` 提供各 hunk 的行数（跨 hunk 时中间 hunk 全选）。
 * combined 模式传 `prefix`（文件路径），key 形如 `path\0hunk:line`。
 */
export function selectionKeys(
  start: DiffPos,
  end: DiffPos,
  hunkLineCounts: number[],
  prefix?: string,
): Set<string> {
  const keys = new Set<string>();
  const p = prefix ? `${prefix}\0` : '';
  const add = (hunk: number, line: number) => keys.add(`${p}${hunk}:${line}`);

  if (start.hunk === end.hunk) {
    for (let line = start.line; line <= end.line; line++) add(start.hunk, line);
    return keys;
  }
  for (let line = start.line; line < (hunkLineCounts[start.hunk] ?? start.line + 1); line++) {
    add(start.hunk, line);
  }
  for (let hunk = start.hunk + 1; hunk < end.hunk; hunk++) {
    for (let line = 0; line < (hunkLineCounts[hunk] ?? 0); line++) add(hunk, line);
  }
  for (let line = 0; line <= end.line; line++) add(end.hunk, line);
  return keys;
}

export type SelectionMode = 'replace' | 'append';

/** 合并选区：replace=替换旧选区；append=追加到旧选区。不修改入参 Set。 */
export function mergeSelection(
  prev: Set<string>,
  keys: Set<string>,
  mode: SelectionMode,
): Set<string> {
  if (mode === 'replace') return new Set(keys);
  const next = new Set(prev);
  for (const key of keys) next.add(key);
  return next;
}

// ─── 折叠段展开（单段全文） ─────────────────────────────────────────────────

export interface CollapsedSectionRange {
  /** 折叠 diff 中 Collapsed 占位行在该 hunk.lines 内的索引。 */
  index: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/** 解析 `N unmodified lines` 折叠占位文本中的行数。 */
export function parseCollapsedCount(text: string): number {
  const m = text.match(/^(\d+)\s+unmodified lines?$/);
  return m ? Number(m[1]) : 0;
}

/** 遍历 hunk，计算每个 Collapsed 占位行隐藏的 old/new 行号区间。 */
export function collapsedSectionRanges(hunk: DiffHunk): CollapsedSectionRange[] {
  const ranges: CollapsedSectionRange[] = [];
  let oldNum = hunk.old_start;
  let newNum = hunk.new_start;
  hunk.lines.forEach((line, index) => {
    if (line.Collapsed !== undefined) {
      const count = parseCollapsedCount(line.Collapsed);
      ranges.push({
        index,
        oldStart: oldNum,
        oldEnd: oldNum + count - 1,
        newStart: newNum,
        newEnd: newNum + count - 1,
      });
      oldNum += count;
      newNum += count;
    } else if (line.Removed !== undefined) {
      oldNum += 1;
    } else if (line.Added !== undefined) {
      newNum += 1;
    } else {
      oldNum += 1;
      newNum += 1;
    }
  });
  return ranges;
}

/** 从全量 hunk 中抽取指定行号区间的 context 行（单段展开的数据来源）。 */
export function spliceFullHunkSection(
  fullHunk: DiffHunk,
  range: CollapsedSectionRange,
): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNum = fullHunk.old_start;
  for (const line of fullHunk.lines) {
    if (line.Context !== undefined) {
      if (oldNum >= range.oldStart && oldNum <= range.oldEnd) {
        out.push({ Context: line.Context });
      }
      oldNum += 1;
    } else if (line.Removed !== undefined) {
      oldNum += 1;
    }
  }
  return out;
}

/** 在（全量）hunks 中查找包含指定旧行号的 hunk。 */
export function findFullHunkForOldLine(hunks: DiffHunk[], oldLine: number): DiffHunk | null {
  for (const hunk of hunks) {
    if (oldLine >= hunk.old_start && oldLine < hunk.old_start + hunk.old_lines) {
      return hunk;
    }
  }
  return null;
}

/** 计算选区中“最后一个选中行”的 key（`hunkIdx:lineIdx`），空选区返回 null。 */
export function lastSelectedKeyOf(selectedLines: ReadonlySet<string> | undefined): string | null {
  if (!selectedLines || selectedLines.size === 0) return null;
  let lastHunk = -1;
  let lastLine = -1;
  for (const key of selectedLines) {
    const [h, l] = key.split(':').map(Number);
    if (h > lastHunk || (h === lastHunk && l > lastLine)) {
      lastHunk = h;
      lastLine = l;
    }
  }
  return lastHunk >= 0 ? `${lastHunk}:${lastLine}` : null;
}
