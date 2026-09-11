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

import { openSourceAtLine } from '../navigate';

describe('openSourceAtLine — DAP 停止行打开源文件（canonical 构造）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  it('DAP 绝对路径直接 canonical 存储（不再相对化），id 与 filePath 一致可推导', async () => {
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 10, 2);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe('p1:/repo/src/main.rs');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('projectPath 快照缺失 → 回退 activeProject.path 作 canonical 根', async () => {
    useProjectStore.setState({
      activeProject: { id: 'p1', path: '/repo' } as never,
    });

    await openSourceAtLine('p1', '', '/repo/src/main.rs', 1);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('同一路径再次停止 → 复用既有 tab（canonical 身份命中）', async () => {
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 10);
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 42);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    expect(space.activeTabId).toBe('p1:/repo/src/main.rs');
  });
});
