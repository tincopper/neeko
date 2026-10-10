import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { useCrossTypeSelection } from '../useCrossTypeSelection';

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

function makeActions() {
  return {
    wslActions: {
      setWslDiffState: undefined,
      resetTransientState: vi.fn(),
      handleRefreshGit: vi.fn(),
      handleOpenWorktreeTerminal: vi.fn(),
      setActiveWorkspacePath: vi.fn(),
    },
    remoteActions: {
      resetTransientState: vi.fn(),
      handleRefreshGit: vi.fn(),
      handleOpenWorktreeTerminal: vi.fn(),
      setActiveWorkspacePath: vi.fn(),
    },
  };
}

describe('useCrossTypeSelection.handleSelectProject — 全局 activeTabId 同步', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null, editorLayout: {}, navigateGoal: null });
    useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });
    useWorkspaceStore.setState({ byProject: {} });
  });

  it('WSL 项目选中后按该项目单元重派生全局 activeTabId（此前缺失 → 停留上一项目）', async () => {
    const project = createProject({
      id: 'p-wsl',
      environment: { type: 'Wsl', distro: 'Ubuntu' },
    });
    useProjectStore.setState({ projects: [project], activeProjectId: null, activeProject: null });
    useEditorStore.getState().addTab(makeFileTab('t1', 'p-wsl'));
    useEditorStore.setState({ activeTabId: null });

    const { wslActions, remoteActions } = makeActions();
    const selectProject = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCrossTypeSelection({ wslActions, remoteActions, selectProject }),
    );

    await act(async () => {
      await result.current.handleSelectProject('p-wsl');
    });

    expect(useEditorStore.getState().activeTabId).toBe('t1');
    // WSL 路径不经 local 的 selectProject
    expect(selectProject).not.toHaveBeenCalled();
  });

  it('Remote 项目选中后同样重派生全局 activeTabId', async () => {
    const project = createProject({
      id: 'p-ssh',
      environment: {
        type: 'Remote',
        host: 'example.com',
        port: 22,
        username: 'u',
        auth: { type: 'password', password: 'p' },
      },
    });
    useProjectStore.setState({ projects: [project], activeProjectId: null, activeProject: null });
    useEditorStore.getState().addTab(makeFileTab('t2', 'p-ssh'));
    useEditorStore.setState({ activeTabId: null });

    const { wslActions, remoteActions } = makeActions();
    const selectProject = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCrossTypeSelection({ wslActions, remoteActions, selectProject }),
    );

    await act(async () => {
      await result.current.handleSelectProject('p-ssh');
    });

    expect(useEditorStore.getState().activeTabId).toBe('t2');
  });
});
