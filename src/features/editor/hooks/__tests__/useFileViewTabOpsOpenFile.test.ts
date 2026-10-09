import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { WorkspaceSession } from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

const { readFileContentMock } = vi.hoisted(() => ({
  readFileContentMock: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
  writeFileContent: vi.fn(),
}));

vi.mock('@/features/action-menu/store/saveAsStore', () => ({
  useSaveAsStore: { getState: () => ({ requestSaveAs: vi.fn() }) },
}));

import { useFileViewTabOps } from '../useFileViewTabOps';

describe('useFileViewTabOps.openFile — FilesPanel 链路 canonical 化', () => {
  const workspaceRef = {
    current: { projectId: 'p1', worktreePath: '/wt' } as WorkspaceSession | null,
  };
  const tabKeyRef = { current: workspaceKeyOf('p1', '/wt') as string | null };

  function renderOps() {
    return renderHook(() =>
      useFileViewTabOps({
        tabKeyRef,
        workspaceRef,
        setError: vi.fn(),
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'p1', path: '/repo' } as never],
      activeProjectId: 'p1',
    });
    readFileContentMock.mockImplementation(async (_ws: unknown, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  it('worktree 激活：身份基准与读取地址同取 worktree 根，tab 存 canonical 绝对路径', async () => {
    const { result } = renderOps();

    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    const space = useEditorStore.getState().tabs[workspaceKeyOf('p1', '/wt')];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe(`${workspaceKeyOf('p1', '/wt')}:/wt/src/a.ts`);
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe('/wt/src/a.ts');
    // 读取走 worktree 地址（FilesPanel 链路的既有语义）
    expect(readFileContentMock).toHaveBeenCalledWith(
      { projectId: 'p1', worktreePath: '/wt' },
      '/wt/src/a.ts',
    );
  });

  it('无 worktree：root=项目路径，相对路径拼项目根 canonical', async () => {
    workspaceRef.current = { projectId: 'p1', worktreePath: null };
    tabKeyRef.current = workspaceKeyOf('p1', null);
    const { result } = renderOps();

    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    const space = useEditorStore.getState().tabs[workspaceKeyOf('p1', null)];
    expect(space.tabs[0].id).toBe(`${workspaceKeyOf('p1', null)}:/repo/src/a.ts`);
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/a.ts',
    );
  });

  it('已打开（canonical 身份命中）→ 激活既有 tab', async () => {
    workspaceRef.current = { projectId: 'p1', worktreePath: '/wt' };
    tabKeyRef.current = workspaceKeyOf('p1', '/wt');
    const { result } = renderOps();
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    await waitFor(() => {
      expect(useEditorStore.getState().tabs[workspaceKeyOf('p1', '/wt')].tabs).toHaveLength(1);
    });
  });
});
