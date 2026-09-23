/**
 * References Peek 纯函数层：引用分组（保序）、预览行窗（边界夹紧）、列表宽度钳制。
 *
 * 高内聚：只做数据整形，不碰 IO / store / 视图。
 * 语言无关：只认 uri + range，不读 languageId（红线 15）。
 */
import { fromFileUri } from '@/features/lsp/api/languageMap';
import type { LspLocation } from '@/features/lsp/types';
import { isJdtUri, jdtDisplayPath } from '@/shared/utils/jdt';

/** 上下文行数（命中行上下各取）。 */
export const PEEK_CONTEXT_LINES = 3;

/** 预览全文行数上限：超出则以命中行为中心开窗（防巨型文件卡死）。 */
export const PEEK_PREVIEW_MAX_LINES = 2000;

/** 左列表宽度（px）：拖拽可调，钳制防挤占预览。 */
export const PEEK_TREE_WIDTH_DEFAULT = 340;
export const PEEK_TREE_WIDTH_MIN = 220;
export const PEEK_TREE_WIDTH_MAX = 600;

export function clampPeekTreeWidth(px: number): number {
  return Math.min(PEEK_TREE_WIDTH_MAX, Math.max(PEEK_TREE_WIDTH_MIN, Math.round(px)));
}

export interface PeekFileGroup {
  uri: string;
  filePath: string;
  /** 原始引用位置（range 完整保留：跳转端口需要真实 end）。 */
  items: LspLocation[];
}

function displayPathOf(uri: string): string {
  if (isJdtUri(uri)) return jdtDisplayPath(uri);
  try {
    return fromFileUri(uri);
  } catch {
    return uri;
  }
}

/**
 * 按 uri 分组，组顺序 = 服务器返回中首次出现的顺序，组内保序。
 */
export function groupReferencesByFile(locations: LspLocation[]): PeekFileGroup[] {
  const groups: PeekFileGroup[] = [];
  const indexByUri = new Map<string, number>();
  for (const location of locations) {
    const idx = indexByUri.get(location.uri);
    if (idx === undefined) {
      indexByUri.set(location.uri, groups.length);
      groups.push({ uri: location.uri, filePath: displayPathOf(location.uri), items: [location] });
    } else {
      groups[idx].items.push(location);
    }
  }
  return groups;
}

export interface PreviewSlice {
  /** 切片行（含命中行），已去行尾符。 */
  lines: string[];
  /** lines[0] 对应文档 0-based 行号。 */
  baseLine0: number;
  /** 命中行在 lines 中的下标。 */
  matchLineIdx: number;
}

/**
 * 预览行窗：小文件给全文（base 0，可滚动浏览完整内容），超大文件以命中行为
 * 中心开窗。越界行号钳到末行。
 */
export function windowPreviewLines(all: string[], line0: number): PreviewSlice {
  if (all.length <= PEEK_PREVIEW_MAX_LINES) {
    const clamped = Math.min(Math.max(0, line0), Math.max(0, all.length - 1));
    return { lines: all, baseLine0: 0, matchLineIdx: clamped };
  }
  return slicePreview(all, line0, PEEK_PREVIEW_MAX_LINES / 2);
}

/**
 * 取命中行上下各 `context` 行；首尾夹紧，越界行号钳到末行。
 *
 * 入参是**已切分的行数组**：同一文件的所有引用共用一份切分结果，不按条目重复
 * `split` 全文（巨型文件 × 多引用的 O(条目 × 行数) 开销）。
 */
export function slicePreview(
  all: string[],
  line0: number,
  context: number = PEEK_CONTEXT_LINES,
): PreviewSlice {
  const last = Math.max(0, all.length - 1);
  const clamped = Math.min(Math.max(0, line0), last);
  const from = Math.max(0, clamped - context);
  const to = Math.min(last, clamped + context);
  return { lines: all.slice(from, to + 1), baseLine0: from, matchLineIdx: clamped - from };
}
