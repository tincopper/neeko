import { fireEvent, render, screen } from '@testing-library/react';
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
  onDiscard: vi.fn(),
  onFileSelect: vi.fn(),
  onOpenFile: vi.fn(),
  onExpandUntrackedDir: vi.fn(),
  loading: false,
};

const TRACKED = [
  file('mod.ts', 'Modified', { x: ' ', y: 'M' }),
  file('staged.ts', 'Modified', { x: 'M', y: ' ' }),
];
const UNVERSIONED = [file('new.ts', 'Untracked', { x: '?', y: '?' })];

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

describe('ChangesList — discard 作用域（分组 × 选中）', () => {
  it('两个分组各有自己的 discard 入口，标题各自反映范围与类别', () => {
    render(<ChangesList {...baseProps} files={[...TRACKED, ...UNVERSIONED]} />);

    expect(screen.getByTitle('Discard all 2 changes')).toBeInTheDocument();
    expect(screen.getByTitle('Discard all 1 unversioned file')).toBeInTheDocument();
  });

  it('无选中时丢弃整组，且 Changes 组的丢弃范围不得包含 unversioned', () => {
    // 回归（需求核心）：旧实现「Discard all」会连 unversioned 一起删。
    const onDiscard = vi.fn();
    render(
      <ChangesList {...baseProps} onDiscard={onDiscard} files={[...TRACKED, ...UNVERSIONED]} />,
    );

    fireEvent.click(screen.getByTitle('Discard all 2 changes'));

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['mod.ts', 'staged.ts'],
      scope: 'group',
      changeClass: 'tracked',
    });
  });

  it('无选中时 Unversioned 组丢弃整组且标注为 unversioned', () => {
    const onDiscard = vi.fn();
    render(
      <ChangesList {...baseProps} onDiscard={onDiscard} files={[...TRACKED, ...UNVERSIONED]} />,
    );

    fireEvent.click(screen.getByTitle('Discard all 1 unversioned file'));

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['new.ts'],
      scope: 'group',
      changeClass: 'unversioned',
    });
  });

  it('组内部分选中时只丢弃选中项（scope=selection）', () => {
    const onDiscard = vi.fn();
    render(
      <ChangesList
        {...baseProps}
        onDiscard={onDiscard}
        selectedFiles={new Set(['staged.ts'])}
        files={[...TRACKED, ...UNVERSIONED]}
      />,
    );

    // Changes 组头按钮随选中态改写标题 = 点击前的第一道确认
    fireEvent.click(screen.getByTitle('Discard 1 selected change'));

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['staged.ts'],
      scope: 'selection',
      changeClass: 'tracked',
    });
  });

  it('选中判定是组内而非全局：Changes 的勾选不影响 Unversioned 组的范围', () => {
    const onDiscard = vi.fn();
    render(
      <ChangesList
        {...baseProps}
        onDiscard={onDiscard}
        selectedFiles={new Set(['mod.ts'])}
        files={[...TRACKED, ...UNVERSIONED]}
      />,
    );

    fireEvent.click(screen.getByTitle('Discard all 1 unversioned file'));

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['new.ts'],
      scope: 'group',
      changeClass: 'unversioned',
    });
  });

  it('组内全选时 scope 归为 group（执行范围与文案一致）', () => {
    const onDiscard = vi.fn();
    render(
      <ChangesList
        {...baseProps}
        onDiscard={onDiscard}
        selectedFiles={new Set(['mod.ts', 'staged.ts'])}
        files={[...TRACKED, ...UNVERSIONED]}
      />,
    );

    fireEvent.click(screen.getByTitle('Discard all 2 changes'));

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['mod.ts', 'staged.ts'],
      scope: 'group',
      changeClass: 'tracked',
    });
  });

  it('行内按钮按所在分组标注类别', () => {
    const onDiscard = vi.fn();
    render(
      <ChangesList {...baseProps} onDiscard={onDiscard} files={[...TRACKED, ...UNVERSIONED]} />,
    );

    // 行内按钮共用 title="Discard changes"，取第 3 个（Unversioned 组的唯一行）
    fireEvent.click(screen.getAllByTitle('Discard changes')[2]!);

    expect(onDiscard).toHaveBeenCalledWith({
      paths: ['new.ts'],
      scope: 'file',
      changeClass: 'unversioned',
    });
  });
});
