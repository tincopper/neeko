import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

vi.mock('../../api/projectApi', () => ({
  setActiveProject: vi.fn().mockResolvedValue(undefined),
}));

import { useProjectSelection } from '../useProjectSelection';

function makeFileTab(id: string, projectId: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of(projectId, null) },
    title: `${id}.ts`,
    order: 0,
    data: {
      kind: 'file',
      filePath: `src/${id}.ts`,
      fileName: `${id}.ts`,
      content: { path: `${id}.ts`, content: '', size: 0, is_binary: false },
      isDirty: false,
    },
  };
}

describe('useProjectSelection.selectProject', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null, editorLayout: {}, navigateGoal: null });
    useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });
    useWorkspaceStore.setState({ byProject: {} });
  });

  it('选中项目按主仓 session.key 恢复 activeTabId（裸 id 读即 miss）', async () => {
    // 主仓单元键 = `p1\0`；裸 `p1` 读不到
    useEditorStore.getState().addTab(makeFileTab('f1', 'p1'));
    expect(useEditorStore.getState().activeTabId).toBe('f1');
    useEditorStore.setState({ activeTabId: null });

    const { result } = renderHook(() => useProjectSelection());
    await act(async () => {
      await result.current.selectProject('p1');
    });

    expect(useProjectStore.getState().activeProjectId).toBe('p1');
    expect(useEditorStore.getState().activeTabId).toBe('f1');
  });
});
