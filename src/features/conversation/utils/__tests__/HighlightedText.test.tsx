import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HighlightedText, highlightParts } from '../HighlightedText';

describe('highlightParts', () => {
  it('returns a single plain part when no query', () => {
    expect(highlightParts('Hello world', '')).toEqual(['Hello world']);
  });

  it('returns a single plain part when query not found', () => {
    expect(highlightParts('Hello world', 'zzz')).toEqual(['Hello world']);
  });

  it('splits text and marks the match', () => {
    const parts = highlightParts('Auth refactor', 'auth');
    expect(parts).toEqual([{ text: 'Auth', highlight: true }, ' refactor']);
  });

  it('is case-insensitive', () => {
    const parts = highlightParts('Auth refactor', 'AUTH');
    expect(parts[0]).toEqual({ text: 'Auth', highlight: true });
  });

  it('highlights every occurrence', () => {
    const parts = highlightParts('a b a b', 'a');
    const highlighted = parts.filter((p) => typeof p !== 'string');
    expect(highlighted).toHaveLength(2);
  });

  it('returns only highlight=true parts when whole text matches', () => {
    expect(highlightParts('exact', 'exact')).toEqual([{ text: 'exact', highlight: true }]);
  });
});

describe('HighlightedText 渲染', () => {
  it('renders <mark> for highlighted parts', () => {
    render(<HighlightedText text="Auth refactor" query="auth" />);
    const mark = screen.getByText((_content, el) => el?.tagName === 'MARK');
    expect(mark).toHaveTextContent('Auth');
    expect(mark.tagName).toBe('MARK');
  });
});
