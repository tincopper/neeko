/**
 * Helpers for converting CodeMirror offsets / mouse coords into LSP positions.
 *
 * LSP uses 0-based line and character; CodeMirror uses 1-based line numbers
 * and absolute document offsets.
 */

import type { Text } from '@codemirror/state';

export interface LspLineChar {
  line: number;
  character: number;
}

/**
 * LSP Position → CodeMirror 文档偏移（`@codemirror/lsp-client` 的 `fromPosition`
 * 未导出，这里是它的夹紧版本）。
 *
 * **必须夹紧**：诊断/编辑常滞后于文档，LSP 侧可能给出已经不存在的坐标，裸
 * `doc.line()` 会抛错并打断整批编辑（一次 import 修复就没了）。语义：行号超范围取
 * 末行，列超行长取行尾，负数取 0。
 */
export function lspPositionToOffset(doc: Text, pos: LspLineChar): number | null {
  if (!doc || !pos || !Number.isFinite(pos.line) || !Number.isFinite(pos.character)) {
    return null;
  }
  const lineNumber = Math.min(Math.max(Math.trunc(pos.line), 0) + 1, doc.lines);
  const line = doc.line(lineNumber);
  const character = Math.min(Math.max(Math.trunc(pos.character), 0), line.length);
  return line.from + character;
}

/** Convert a document offset + line metadata into an LSP Position. */
export function offsetToLspPosition(
  pos: number,
  lineNumber: number,
  lineFrom: number,
): LspLineChar {
  return {
    line: lineNumber - 1,
    character: pos - lineFrom,
  };
}

/**
 * Resolve an LSP position from a document offset (e.g. from `view.posAtCoords`).
 *
 * Returns null when the offset is null (click outside the editor) or when
 * line lookup fails.
 */
export function resolveLspPositionFromOffset(
  pos: number | null,
  lineAt: (pos: number) => { number: number; from: number },
): LspLineChar | null {
  if (pos === null || pos < 0) return null;
  try {
    const lineObj = lineAt(pos);
    return offsetToLspPosition(pos, lineObj.number, lineObj.from);
  } catch {
    return null;
  }
}
