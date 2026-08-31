import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileChange } from '@/shared/types';

import Section from '../ChangesSection';

const baseProps = {
  title: 'Changes',
  count: 2,
  additions: 1,
  deletions: 5,
  expanded: true,
  onToggle: vi.fn(),
  selectedFiles: new Set<string>(),
  allSelected: false,
  onSelectAll: vi.fn(),
  onToggleFile: vi.fn(),
  onDiscardFile: vi.fn(),
  loading: false,
};

function file(overrides: Partial<FileChange>): FileChange {
  return { path: 'src/a.ts', status: 'Modified', additions: 1, deletions: 0, ...overrides };
}

describe('ChangesSection — Deleted 文件删除线标识', () => {
  it('Deleted 文件名带 line-through（删除线）', () => {
    render(<Section {...baseProps} files={[file({ status: 'Deleted', deletions: 5 })]} />);

    expect(screen.getByText('a.ts')).toHaveClass('line-through');
  });

  it('Modified 文件名不带删除线', () => {
    render(<Section {...baseProps} files={[file({ status: 'Modified', additions: 1 })]} />);

    expect(screen.getByText('a.ts')).not.toHaveClass('line-through');
  });

  it('Added / Renamed 文件名不带删除线', () => {
    render(
      <Section
        {...baseProps}
        files={[
          file({ path: 'src/b.ts', status: 'Added' }),
          file({ path: 'src/c.ts', status: 'Renamed' }),
        ]}
      />,
    );

    expect(screen.getByText('b.ts')).not.toHaveClass('line-through');
    expect(screen.getByText('c.ts')).not.toHaveClass('line-through');
  });
});

describe('ChangesSection — 行内 Open File 按钮', () => {
  it('传入 onOpenFile 时渲染按钮，点击回调携带文件路径', () => {
    const onOpenFile = vi.fn();
    render(
      <Section
        {...baseProps}
        onOpenFile={onOpenFile}
        files={[file({ path: 'src/a.ts', status: 'Modified' })]}
      />,
    );

    const btn = screen.getByTitle('Open File');
    fireEvent.click(btn);

    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts');
  });

  it('未传 onOpenFile 时不渲染按钮', () => {
    render(<Section {...baseProps} files={[file({ status: 'Modified' })]} />);

    expect(screen.queryByTitle('Open File')).not.toBeInTheDocument();
  });

  it('点击按钮不触发行选中（stopPropagation）', () => {
    const onFileSelect = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <Section
        {...baseProps}
        onFileSelect={onFileSelect}
        onOpenFile={onOpenFile}
        files={[file({ status: 'Modified' })]}
      />,
    );

    fireEvent.click(screen.getByTitle('Open File'));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
