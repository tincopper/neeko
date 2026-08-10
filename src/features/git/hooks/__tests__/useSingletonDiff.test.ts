import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useSingletonDiff } from '@/features/git/hooks/useSingletonDiff';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { ConnectionContext } from '@/shared/types';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

describe('useSingletonDiff worktree tab projectId', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null });
    useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: '' });
  });

  it('worktree 激活时 diff tab 的 projectId 是真实 project id 而非复合 tab key（回归：Project not found）', () => {
    const projectId = 'proj-1';
    const wtPath = '/wt/proj';
    useProjectStore.setState({ activeProjectId: projectId });
    useWorktreeStore.setState({ activeWorktreePath: wtPath, activeWorktreeBranch: 'feature-x' });

    const ctx: ConnectionContext = { type: 'local', projectId };
    const { result } = renderHook(() => useSingletonDiff(projectId, 'abc123', [], ctx, wtPath));

    act(() => {
      result.current.openFileInDiff('src/main.ts');
    });

    const tabKey = buildWorktreeTabKey(projectId, wtPath);
    const diffTab = useEditorStore
      .getState()
      .tabs[tabKey]?.tabs.find((t) => t.data.kind === 'diff');
    expect(diffTab).toBeDefined();
    // tab 的 projectId 必须保持真实 project id，否则后端 resolve_project 找不到项目
    expect(diffTab?.projectId).toBe(projectId);
  });
});
