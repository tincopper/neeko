import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useOpenStashDiff } from '@/features/git/hooks/useOpenStashDiff';
import type { StashEntry } from '@/features/git/types';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

const STASHES: StashEntry[] = [
  {
    selector: 'stash@{0}',
    hash: 'abc123',
    message: 'WIP on feature-x',
    branch: 'feature-x',
    timestamp: '2026-08-14T10:00:00Z',
  },
  {
    selector: 'stash@{1}',
    hash: 'def456',
    message: '',
    branch: 'main',
    timestamp: '2026-08-13T10:00:00Z',
  },
];

describe('useOpenStashDiff', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null });
    useProjectStore.setState({ activeProjectId: null });
    useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: '' });
  });

  it('点击 stash 文件打开 diff tab：diffSource 为 stash 变体，标题 stash@{n}: <message>', () => {
    const { result } = renderHook(() => useOpenStashDiff('proj-1', null, STASHES));

    act(() => {
      result.current('stash@{0}', 'src/a.ts');
    });

    const tab = useEditorStore.getState().tabs['proj-1']?.tabs.find((t) => t.data.kind === 'diff');
    expect(tab).toBeDefined();
    expect(tab?.projectId).toBe('proj-1');
    expect(tab?.title).toBe('stash@{0}: WIP on feature-x');
    expect(tab?.data).toMatchObject({
      kind: 'diff',
      filePath: 'src/a.ts',
      fileName: 'a.ts',
      diffSource: { type: 'stash', projectId: 'proj-1', selector: 'stash@{0}' },
    });
    expect(useEditorStore.getState().activeTabId).toBe(tab?.id);
  });

  it('无 message 时标题回退为 selector', () => {
    const { result } = renderHook(() => useOpenStashDiff('proj-1', null, STASHES));

    act(() => {
      result.current('stash@{1}', 'src/b.ts');
    });

    const tab = useEditorStore.getState().tabs['proj-1']?.tabs.find((t) => t.data.kind === 'diff');
    expect(tab?.title).toBe('stash@{1}');
  });

  it('已存在同 stash 同文件 diff tab 时激活而非新建', () => {
    const { result } = renderHook(() => useOpenStashDiff('proj-1', null, STASHES));

    act(() => {
      result.current('stash@{0}', 'src/a.ts');
    });
    const first = useEditorStore
      .getState()
      .tabs['proj-1']?.tabs.find((t) => t.data.kind === 'diff');

    act(() => {
      result.current('stash@{0}', 'src/a.ts');
    });

    const diffTabs = useEditorStore
      .getState()
      .tabs['proj-1']?.tabs.filter((t) => t.data.kind === 'diff');
    expect(diffTabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe(first?.id);
  });

  it('worktree 激活时 diff tab 落在 worktree tab key 且 projectId 为真实 project id', () => {
    const wtPath = '/wt/proj';
    useProjectStore.setState({ activeProjectId: 'proj-1' });
    useWorktreeStore.setState({ activeWorktreePath: wtPath, activeWorktreeBranch: 'feature-x' });
    const { result } = renderHook(() => useOpenStashDiff('proj-1', wtPath, STASHES));

    act(() => {
      result.current('stash@{0}', 'src/a.ts');
    });

    const tabKey = buildWorktreeTabKey('proj-1', wtPath);
    const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.data.kind === 'diff');
    expect(tab).toBeDefined();
    expect(tab?.projectId).toBe('proj-1');
  });
});
