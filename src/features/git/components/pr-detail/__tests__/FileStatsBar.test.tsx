import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import FileStatsBar from '@/features/git/components/pr-detail/FileStatsBar';
import type { PRFileChange } from '@/features/git/types';

function makeFile(overrides?: Partial<PRFileChange>): PRFileChange {
  return { path: 'test.ts', status: 'modified', additions: 5, deletions: 3, ...overrides };
}

describe('FileStatsBar', () => {
  it('returns null when files array is empty', () => {
    const { container } = render(<FileStatsBar files={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('displays file count', () => {
    render(<FileStatsBar files={[makeFile()]} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('file changed')).toBeInTheDocument();
  });

  it('displays plural "files" for multiple files', () => {
    const files = [makeFile({ path: 'a.ts' }), makeFile({ path: 'b.ts' })];
    render(<FileStatsBar files={files} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('files changed')).toBeInTheDocument();
  });

  it('shows total additions', () => {
    const files = [
      makeFile({ path: 'a.ts', additions: 10 }),
      makeFile({ path: 'b.ts', additions: 5 }),
    ];
    render(<FileStatsBar files={files} />);
    expect(screen.getByText('+15')).toBeInTheDocument();
  });

  it('shows total deletions', () => {
    const files = [
      makeFile({ path: 'a.ts', deletions: 7 }),
      makeFile({ path: 'b.ts', deletions: 3 }),
    ];
    render(<FileStatsBar files={files} />);
    expect(screen.getByText('-10')).toBeInTheDocument();
  });

  it('hides additions when zero', () => {
    const files = [makeFile({ additions: 0, deletions: 5 })];
    render(<FileStatsBar files={files} />);
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
  });

  it('hides deletions when zero', () => {
    const files = [makeFile({ additions: 5, deletions: 0 })];
    render(<FileStatsBar files={files} />);
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
  });

  it('handles files with undefined additions/deletions', () => {
    const files = [makeFile({ additions: undefined, deletions: undefined })];
    render(<FileStatsBar files={files} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('+')).not.toBeInTheDocument();
    expect(screen.queryByText('-')).not.toBeInTheDocument();
  });
});
