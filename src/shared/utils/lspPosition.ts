/**
 * Helpers for converting CodeMirror offsets / mouse coords into LSP positions.
 *
 * LSP uses 0-based line and character; CodeMirror uses 1-based line numbers
 * and absolute document offsets.
 */

export interface LspLineChar {
  line: number;
  character: number;
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
