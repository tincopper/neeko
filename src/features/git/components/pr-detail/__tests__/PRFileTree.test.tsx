import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import PRFileTree from '@/features/git/components/pr-detail/PRFileTree';
import type { PRFileChange } from '@/features/git/types';

function makeFile(path: string, overrides?: Partial<PRFileChange>): PRFileChange {
  return { path, status: 'modified', additions: 5, deletions: 3, ...overrides };
}

describe('PRFileTree', () => {
  const files: PRFileChange[] = [
    makeFile('src/main.ts', { status: 'modified', additions: 10, deletions: 4 }),
    makeFile('src/utils/helper.ts', { status: 'added', additions: 20, deletions: 0 }),
    makeFile('README.md', { status: 'removed', additions: 0, deletions: 15 }),
  ];

  it('renders PR file tree with file names', () => {
    render(<PRFileTree files={files} />);
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('helper.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('renders status badges', () => {
    render(<PRFileTree files={files} />);
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('calls onFileClick when a file is clicked', () => {
    const onFileClick = vi.fn();
    render(<PRFileTree files={files} onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('main.ts'));
    expect(onFileClick).toHaveBeenCalledWith('src/main.ts');
  });

  it('highlights selected file', () => {
    const { container } = render(
      <PRFileTree files={files} selectedPath="README.md" />,
    );
    const rows = container.querySelectorAll('[title="README.md"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].className).toContain('bg-accent-blue/10');
  });

  it('does not highlight non-selected files', () => {
    const { container } = render(
      <PRFileTree files={files} selectedPath="README.md" />,
    );
    const mainRow = container.querySelector('[title="src/main.ts"]');
    expect(mainRow?.className).not.toContain('bg-accent-blue/10');
  });

  it('shows loading skeleton when loading', () => {
    const { container } = render(<PRFileTree files={[]} loading />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('shows "No files changed" when empty and not loading', () => {
    render(<PRFileTree files={[]} />);
    expect(screen.getByText('No files changed')).toBeInTheDocument();
  });
});
