import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

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
  const workspaceRef = { current: WorkspaceSession.of('p1', '/wt') as WorkspaceSession | null };
  const tabKeyRef = { current: WorkspaceSession.of('p1', '/wt').key as string | null };

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

    const space = useEditorStore.getState().tabs[WorkspaceSession.of('p1', '/wt').key];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe(`${WorkspaceSession.of('p1', '/wt').key}:/wt/src/a.ts`);
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe('/wt/src/a.ts');
    // 读取走 worktree 地址（FilesPanel 链路的既有语义）
    expect(readFileContentMock).toHaveBeenCalledWith(
      { projectId: 'p1', worktreePath: '/wt' },
      '/wt/src/a.ts',
    );
  });

  it('无 worktree：root=项目路径，相对路径拼项目根 canonical', async () => {
    workspaceRef.current = WorkspaceSession.of('p1', null);
    tabKeyRef.current = WorkspaceSession.of('p1', null).key;
    const { result } = renderOps();

    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    const space = useEditorStore.getState().tabs[WorkspaceSession.of('p1', null).key];
    expect(space.tabs[0].id).toBe(`${WorkspaceSession.of('p1', null).key}:/repo/src/a.ts`);
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/a.ts',
    );
  });

  it('已打开（canonical 身份命中）→ 激活既有 tab', async () => {
    workspaceRef.current = WorkspaceSession.of('p1', '/wt');
    tabKeyRef.current = WorkspaceSession.of('p1', '/wt').key;
    const { result } = renderOps();
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    await waitFor(() => {
      expect(
        useEditorStore.getState().tabs[WorkspaceSession.of('p1', '/wt').key].tabs,
      ).toHaveLength(1);
    });
  });
});
