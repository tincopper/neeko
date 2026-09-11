import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';

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
  const tabKeyRef = { current: 'p1:wt:/wt' as string | null };
  const worktreePathRef = { current: '/wt' as string | null | undefined };
  const externalCommandsRef = { current: undefined };

  function renderOps() {
    return renderHook(() =>
      useFileViewTabOps({
        tabKeyRef,
        worktreePathRef,
        externalCommandsRef,
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
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  it('worktree 激活：root=worktree 路径（与后端 resolve_base 对齐），tab 存 canonical 绝对路径', async () => {
    const { result } = renderOps();

    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    const space = useEditorStore.getState().tabs['p1:wt:/wt'];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe('p1:wt:/wt:/wt/src/a.ts');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe('/wt/src/a.ts');
    // 读取走 worktree rootPath（FilesPanel 链路的既有语义）
    expect(readFileContentMock).toHaveBeenCalledWith('p1', '/wt/src/a.ts', '/wt');
  });

  it('无 worktree：root=项目路径，相对路径拼项目根 canonical', async () => {
    tabKeyRef.current = 'p1';
    worktreePathRef.current = null;
    const { result } = renderOps();

    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].id).toBe('p1:/repo/src/a.ts');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/a.ts',
    );
  });

  it('已打开（canonical 身份命中）→ 激活既有 tab', async () => {
    tabKeyRef.current = 'p1:wt:/wt';
    worktreePathRef.current = '/wt';
    const { result } = renderOps();
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });
    await act(async () => {
      await result.current.openFile('src/a.ts');
    });

    await waitFor(() => {
      expect(useEditorStore.getState().tabs['p1:wt:/wt'].tabs).toHaveLength(1);
    });
  });
});
