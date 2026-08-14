import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StashActionResult, StashEntry } from '@/features/git/types';

import StashPanel from '../StashPanel';

const STASHES: StashEntry[] = [
  {
    selector: 'stash@{0}',
    hash: 'abc123',
    message: 'WIP on main: stash content view',
    branch: 'main',
    timestamp: '2026-08-14T10:00:00',
  },
];

const FILES = [
  { path: 'src/a.ts', status: 'M', additions: 2, deletions: 1 },
  { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
];

interface RenderOptions {
  stashes?: StashEntry[];
  loading?: boolean;
  error?: string | null;
  expandedSelector?: string | null;
  expandedFiles?: typeof FILES;
  filesLoading?: boolean;
  filesError?: string | null;
  actionLoading?: boolean;
  onApply?: () => Promise<StashActionResult | null>;
  onPop?: () => Promise<StashActionResult | null>;
  onRefreshGit?: () => Promise<void>;
  onOpenStashDiff?: (selector: string, filePath: string) => void;
}

function renderPanel(overrides: RenderOptions = {}) {
  const props = {
    stashes: overrides.stashes ?? STASHES,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    expandedSelector: overrides.expandedSelector ?? null,
    expandedFiles: overrides.expandedFiles ?? [],
    filesLoading: overrides.filesLoading ?? false,
    filesError: overrides.filesError ?? null,
    onToggle: vi.fn(),
    actionLoading: overrides.actionLoading ?? false,
    onApply: overrides.onApply ?? vi.fn().mockResolvedValue({ success: true, message: '' }),
    onPop: overrides.onPop ?? vi.fn().mockResolvedValue({ success: true, message: '' }),
    onShowToast: vi.fn(),
    onRefreshGit: overrides.onRefreshGit ?? vi.fn().mockResolvedValue(undefined),
    onOpenStashDiff: overrides.onOpenStashDiff ?? vi.fn(),
  };
  const utils = render(<StashPanel {...props} />);
  return { ...utils, props };
}

describe('StashPanel', () => {
  it('renders empty state when no stashes', () => {
    renderPanel({ stashes: [] });
    expect(screen.getByText('No stashes')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    renderPanel({ loading: true });
    expect(screen.getByText(/Loading stashes/)).toBeInTheDocument();
  });

  it('renders error state', () => {
    renderPanel({ error: 'stash load failed' });
    expect(screen.getByText('stash load failed')).toBeInTheDocument();
  });

  it('shows file list with gitlog-style rows when expanded', () => {
    renderPanel({ expandedSelector: 'stash@{0}', expandedFiles: FILES });
    // gitlog 风格：文件名与目录拆开显示
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getAllByText('src').length).toBe(2);
    // 增删统计
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('opens a diff tab when a file is clicked', () => {
    const onOpenStashDiff = vi.fn();
    renderPanel({ expandedSelector: 'stash@{0}', expandedFiles: FILES, onOpenStashDiff });
    fireEvent.click(screen.getByText('a.ts'));
    expect(onOpenStashDiff).toHaveBeenCalledWith('stash@{0}', 'src/a.ts');
  });

  it('disables action buttons and shows hint when nothing selected', () => {
    renderPanel();
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    const pop = screen.getByRole('button', { name: 'Pop' }) as HTMLButtonElement;
    expect(apply).toBeDisabled();
    expect(pop).toBeDisabled();
    expect(screen.getByText('请先选择一条 stash')).toBeInTheDocument();
  });

  it('enables action buttons when a stash is selected', () => {
    renderPanel({ expandedSelector: 'stash@{0}' });
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    const pop = screen.getByRole('button', { name: 'Pop' }) as HTMLButtonElement;
    expect(apply).toBeEnabled();
    expect(pop).toBeEnabled();
  });

  it('disables action buttons while an action is loading', () => {
    renderPanel({ expandedSelector: 'stash@{0}', actionLoading: true });
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    const pop = screen.getByRole('button', { name: 'Pop' }) as HTMLButtonElement;
    expect(apply).toBeDisabled();
    expect(pop).toBeDisabled();
  });

  it('applies a stash: success toast + git refresh, entry kept', async () => {
    const onApply = vi.fn().mockResolvedValue({ success: true, message: '' });
    const onRefreshGit = vi.fn().mockResolvedValue(undefined);
    const { props } = renderPanel({
      expandedSelector: 'stash@{0}',
      onApply,
      onRefreshGit,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('stash@{0}'));
    expect(props.onShowToast).toHaveBeenCalledWith('已应用 stash@{0}，条目保留', 'info');
    expect(onRefreshGit).toHaveBeenCalledTimes(1);
  });

  it('surfaces apply failure as error toast without refreshing', async () => {
    const onApply = vi.fn().mockResolvedValue({ success: false, message: 'conflict' });
    const onRefreshGit = vi.fn().mockResolvedValue(undefined);
    const { props } = renderPanel({ expandedSelector: 'stash@{0}', onApply, onRefreshGit });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(props.onShowToast).toHaveBeenCalledWith('conflict', 'error'));
    expect(onRefreshGit).not.toHaveBeenCalled();
  });

  it('pops a stash: success toast + git refresh', async () => {
    const onPop = vi.fn().mockResolvedValue({ success: true, message: '' });
    const onRefreshGit = vi.fn().mockResolvedValue(undefined);
    const { props } = renderPanel({ expandedSelector: 'stash@{0}', onPop, onRefreshGit });
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    await waitFor(() => expect(onPop).toHaveBeenCalledWith('stash@{0}'));
    expect(props.onShowToast).toHaveBeenCalledWith('已弹出，条目移除', 'info');
    expect(onRefreshGit).toHaveBeenCalledTimes(1);
  });

  it('surfaces pop failure as error toast without refreshing', async () => {
    const onPop = vi.fn().mockResolvedValue({ success: false, message: 'pop conflict' });
    const onRefreshGit = vi.fn().mockResolvedValue(undefined);
    const { props } = renderPanel({ expandedSelector: 'stash@{0}', onPop, onRefreshGit });
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    await waitFor(() => expect(props.onShowToast).toHaveBeenCalledWith('pop conflict', 'error'));
    expect(onRefreshGit).not.toHaveBeenCalled();
  });
});
