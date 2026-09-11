import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';

const { readFileContentMock, preloadMock } = vi.hoisted(() => ({
  readFileContentMock: vi.fn(),
  preloadMock: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
}));

vi.mock('@/shared/utils/codemirror', () => ({
  preloadLanguageExtension: preloadMock,
}));

import { openProjectFile } from '../openFile';

describe('openProjectFile — file tab 构造 canonical 化（quick-open 链路）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'p1', path: '/repo' } as never],
      activeProjectId: 'p1',
    });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  it('相对路径 → tab id / data.filePath 存 canonical 绝对路径（root=项目根）', async () => {
    await openProjectFile({ projectId: 'p1', filePath: 'src/a.ts' });

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe('p1:/repo/src/a.ts');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/a.ts',
    );
  });

  it('已打开（按 canonical 身份）→ 激活既有 tab，不重复开', async () => {
    await openProjectFile({ projectId: 'p1', filePath: 'src/a.ts' });
    await openProjectFile({ projectId: 'p1', filePath: 'src/a.ts' });

    expect(useEditorStore.getState().tabs['p1'].tabs).toHaveLength(1);
  });

  it('worktree 激活：tab 落 worktree 键空间，路径仍按项目根 canonical（与 readFileContent 缺省 base 一致）', async () => {
    useWorktreeStore.setState({ activeWorktreePath: '/wt' });

    await openProjectFile({ projectId: 'p1', filePath: 'src/a.ts' });

    const space = useEditorStore.getState().tabs['p1:wt:/wt'];
    expect(space).toBeDefined();
    expect(space.tabs[0].id).toBe('p1:wt:/wt:/repo/src/a.ts');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/a.ts',
    );
  });
});
