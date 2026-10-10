import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useOpenDiffTab } from '../useOpenDiffTab';

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: 'proj-1' });
  useEditorStore.setState({ tabs: {}, activeTabId: null, editorLayout: {} });
});

describe('useOpenDiffTab', () => {
  it('should_open_a_new_diff_tab_and_activate_it', () => {
    const { result } = renderHook(() => useOpenDiffTab(null));

    act(() => {
      result.current('src/App.tsx');
    });

    const tabs =
      useEditorStore.getState().tabs[WorkspaceSession.of('proj-1', null).key]?.tabs ?? [];
    expect(tabs).toHaveLength(1);
    const tab = tabs[0] as Tab;
    expect(tab.scope.session.projectId).toBe('proj-1');
    expect(tab.title).toBe('Commit Diff · App.tsx');
    expect(tab.data.kind).toBe('diff');
    if (tab.data.kind === 'diff') {
      expect(tab.data.filePath).toBe('src/App.tsx');
      expect(tab.data.diffSource).toEqual({
        workspace: WorkspaceSession.of('proj-1', null),
        revision: { type: 'worktree' },
      });
    }
    expect(
      useEditorStore.getState().tabs[WorkspaceSession.of('proj-1', null).key]?.activeTabId,
    ).toBe(tab.id);
  });

  it('should_activate_existing_diff_tab_for_same_file_instead_of_duplicating', () => {
    const { result } = renderHook(() => useOpenDiffTab(null));

    act(() => {
      result.current('src/App.tsx');
      result.current('src/App.tsx');
    });

    const tabs =
      useEditorStore.getState().tabs[WorkspaceSession.of('proj-1', null).key]?.tabs ?? [];
    expect(tabs).toHaveLength(1);
  });

  it('should_use_worktree_tab_key_when_worktree_is_active', () => {
    const { result } = renderHook(() => useOpenDiffTab('/test/wt', 'proj-1'));

    act(() => {
      result.current('src/App.tsx');
    });

    // worktree tab key 形如 proj-1:wt:<path>
    const tabKeys = Object.keys(useEditorStore.getState().tabs);
    expect(tabKeys).toHaveLength(1);
    expect(tabKeys[0]).toContain('wt');
    expect(tabKeys[0]).not.toBe('proj-1');
    // tab 的 projectId 仍是真实项目 id
    const tab = useEditorStore.getState().tabs[tabKeys[0]]?.tabs[0] as Tab;
    expect(tab.scope.session.projectId).toBe('proj-1');
  });

  it('should_build_worktree_diff_source_with_workspace_address (环境维度由 commands 承载)', () => {
    // 环境（WSL/SSH）不再是 DiffSource 的一部分：它由按Workspace构造的 ProjectCommands 携带。
    // DiffSource 只承载 Workspace 地址 + 修订维度。
    const { result } = renderHook(() => useOpenDiffTab('/test/wt', 'proj-1'));

    act(() => {
      result.current('README.md');
    });

    const tab = useEditorStore.getState().tabs[WorkspaceSession.of('proj-1', '/test/wt').key]
      ?.tabs[0] as Tab;
    if (tab.data.kind === 'diff') {
      expect(tab.data.diffSource).toEqual({
        workspace: WorkspaceSession.of('proj-1', '/test/wt'),
        revision: { type: 'worktree' },
      });
    }
  });
});
