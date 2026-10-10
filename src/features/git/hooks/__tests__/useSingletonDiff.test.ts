import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useSingletonDiff } from '@/features/git/hooks/useSingletonDiff';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ConnectionContext } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

describe('useSingletonDiff worktree tab projectId', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null });
    useWorkspaceStore.setState({ byProject: {} });
  });

  it('worktree 激活时 diff tab 的 projectId 是真实 project id 而非复合 tab key（回归：Project not found）', () => {
    const projectId = 'proj-1';
    const wtPath = '/wt/proj';
    useProjectStore.setState({ activeProjectId: projectId });
    useWorkspaceStore.getState().setActiveWorkspace(projectId, wtPath, 'feature-x');

    const ctx: ConnectionContext = { type: 'local', projectId };
    const { result } = renderHook(() => useSingletonDiff(projectId, 'abc123', [], ctx, wtPath));

    act(() => {
      result.current.openFileInDiff('src/main.ts');
    });

    const tabKey = WorkspaceSession.of(projectId, wtPath ?? null).key;
    const diffTab = useEditorStore
      .getState()
      .tabs[tabKey]?.tabs.find((t) => t.data.kind === 'diff');
    expect(diffTab).toBeDefined();
    // tab 的 projectId 必须保持真实 project id，否则后端 resolve_project 找不到项目
    expect(diffTab?.scope.session.projectId).toBe(projectId);
  });
});
