import { describe, expect, it } from 'vitest';

import { offsetToLspPosition, resolveLspPositionFromOffset } from '../position';

describe('offsetToLspPosition', () => {
  it('should_map_1based_line_and_offset_to_0based_lsp_position', () => {
    // line 3 (1-based), starts at doc offset 20, cursor at 27 → char 7
    expect(offsetToLspPosition(27, 3, 20)).toEqual({ line: 2, character: 7 });
  });

  it('should_return_character_zero_at_line_start', () => {
    expect(offsetToLspPosition(10, 2, 10)).toEqual({ line: 1, character: 0 });
  });
});

describe('resolveLspPositionFromOffset', () => {
  const lineAt = (pos: number) => {
    // Fake doc: line1 0-9, line2 10-19, line3 20-29
    if (pos < 10) return { number: 1, from: 0 };
    if (pos < 20) return { number: 2, from: 10 };
    return { number: 3, from: 20 };
  };

  it('should_return_null_when_offset_is_null', () => {
    // posAtCoords returns null when click is outside the editor
    expect(resolveLspPositionFromOffset(null, lineAt)).toBeNull();
  });

  it('should_resolve_lsp_position_from_document_offset', () => {
    // Click mapped to offset 26 on line 3
    expect(resolveLspPositionFromOffset(26, lineAt)).toEqual({
      line: 2,
      character: 6,
    });
  });

  it('should_return_null_when_lineAt_throws', () => {
    const throwing = () => {
      throw new Error('out of range');
    };
    expect(resolveLspPositionFromOffset(999, throwing)).toBeNull();
  });
});
