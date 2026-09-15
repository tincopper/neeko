import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileChange } from '@/shared/types';

import ChangesList from '../ChangesList';

function file(
  path: string,
  status: FileChange['status'],
  xy?: { x?: string; y?: string },
): FileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 0,
    ...(xy?.x !== undefined ? { index_status: xy.x } : {}),
    ...(xy?.y !== undefined ? { worktree_status: xy.y } : {}),
  };
}

const baseProps = {
  selectedFiles: new Set<string>(),
  onToggleFile: vi.fn(),
  onDiscardFile: vi.fn(),
  onFileSelect: vi.fn(),
  onOpenFile: vi.fn(),
  onExpandUntrackedDir: vi.fn(),
  loading: false,
};

describe('ChangesList — G6 简化双分组', () => {
  it('只渲染 Changes 与 Unversioned 两个分组，tracked/untracked 各归其组', () => {
    render(
      <ChangesList
        {...baseProps}
        files={[
          file('mod.ts', 'Modified', { x: ' ', y: 'M' }), // tracked (wt-only)
          file('staged.ts', 'Modified', { x: 'M', y: ' ' }), // tracked (staged-only)
          file('new.ts', 'Untracked', { x: '?', y: '?' }), // unversioned
        ]}
      />,
    );

    expect(screen.getByText(/^Changes \(2\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Unversioned \(1\)$/)).toBeInTheDocument();
    // 旧四分组标题不得出现
    expect(screen.queryByText(/Staged Changes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Merge Conflicts/)).not.toBeInTheDocument();
    expect(screen.getByText('mod.ts')).toBeInTheDocument();
    expect(screen.getByText('staged.ts')).toBeInTheDocument();
    expect(screen.getByText('new.ts')).toBeInTheDocument();
  });

  it('同一文件 XY 双非空在 tracked 组只显示一条', () => {
    render(
      <ChangesList {...baseProps} files={[file('readme.md', 'Modified', { x: 'M', y: 'M' })]} />,
    );

    expect(screen.getByText(/^Changes \(1\)$/)).toBeInTheDocument();
    expect(screen.getAllByText('readme.md')).toHaveLength(1);
  });

  it('冲突文件并入 Changes 分组且带行级冲突标记', () => {
    render(
      <ChangesList {...baseProps} files={[file('conflict.ts', 'Added', { x: 'A', y: 'A' })]} />,
    );

    expect(screen.getByText(/^Changes \(1\)$/)).toBeInTheDocument();
    expect(screen.getByTitle('Merge conflict')).toBeInTheDocument();
    expect(screen.queryByText(/Merge Conflicts/)).not.toBeInTheDocument();
  });

  it('stage 按钮只出现在 Unversioned 分组（Changes 组无 stage 入口）', () => {
    const onStageFile = vi.fn();
    // Changes（tracked）组行内不得有 stage 入口
    const { unmount } = render(
      <ChangesList
        {...baseProps}
        onStageFile={onStageFile}
        files={[file('mod.ts', 'Modified', { x: ' ', y: 'M' })]}
      />,
    );
    expect(screen.queryByTitle('Stage file (git add)')).not.toBeInTheDocument();
    unmount();

    // Unversioned（untracked）组行内有 stage 入口
    render(
      <ChangesList
        {...baseProps}
        onStageFile={onStageFile}
        files={[file('new.ts', 'Untracked', { x: '?', y: '?' })]}
      />,
    );
    expect(screen.getByTitle('Stage file (git add)')).toBeInTheDocument();
  });

  it('无文件时显示 No changes', () => {
    render(<ChangesList {...baseProps} files={[]} />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});
