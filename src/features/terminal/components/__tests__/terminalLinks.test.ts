import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';

const { readFileContentMock, revealInFileManagerMock } = vi.hoisted(() => ({
  readFileContentMock: vi.fn(),
  revealInFileManagerMock: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
  revealInFileManager: revealInFileManagerMock,
}));

import { setupTerminalLinks } from '../terminalLinks';

interface CapturedProvider {
  provideLinks: (
    bufferLineNumber: number,
    callback: (links: Array<{ activate: (e: MouseEvent) => void }> | undefined) => void,
  ) => void;
}

function makeFakeTerm(lineText: string) {
  let provider: CapturedProvider | null = null;
  const term = {
    element: document.createElement('div'),
    cols: 80,
    rows: 10,
    options: {},
    loadAddon: vi.fn(),
    registerLinkProvider: vi.fn((p: CapturedProvider) => {
      provider = p;
    }),
    buffer: {
      active: {
        getLine: (n: number) => (n === 0 ? { translateToString: () => lineText } : undefined),
      },
    },
  };
  return { term: term as unknown as Terminal, getProvider: () => provider };
}

describe('terminalLinks — 文件路径链接打开编辑器（canonical 构造）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  it('绝对路径 → tab id / data.filePath canonical 存储', async () => {
    const { term, getProvider } = makeFakeTerm('Error at /repo/src/main.rs:10:2');
    setupTerminalLinks(term, {
      projectPath: '/repo',
      tabKey: 'p1',
      workspace: { projectId: 'p1', worktreePath: null },
    });

    let links: Array<{ activate: (e: MouseEvent) => void }> | undefined;
    getProvider()!.provideLinks(1, (l) => {
      links = l;
    });
    expect(links).toHaveLength(1);

    await links![0].activate({ metaKey: true, button: 0 } as unknown as MouseEvent);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].id).toBe('p1:/repo/src/main.rs');
    // 地址由 options 携带的**值**给出（不再取点击时的激活视图）
    expect(readFileContentMock).toHaveBeenCalledWith(
      { projectId: 'p1', worktreePath: null },
      '/repo/src/main.rs',
    );
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('相对路径（反斜杠分段）→ 拼项目根并统一斜杠 canonical', async () => {
    const { term, getProvider } = makeFakeTerm('Build src\\main.rs failed');
    setupTerminalLinks(term, {
      projectPath: '/repo',
      tabKey: 'p1',
      workspace: { projectId: 'p1', worktreePath: null },
    });

    let links: Array<{ activate: (e: MouseEvent) => void }> | undefined;
    getProvider()!.provideLinks(1, (l) => {
      links = l;
    });
    await links![0].activate({ metaKey: true, button: 0 } as unknown as MouseEvent);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });
});

describe('terminalLinks — worktree pane：地址随 pane 携带（单元不漂移）', () => {
  it('pane 属于 worktree 时，读取与 tab 记录都用该 pane 的 workspace 值', async () => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    const { term, getProvider } = makeFakeTerm('Error at /wt/src/main.rs:10:2');
    const paneWorkspace = { projectId: 'p1', worktreePath: '/wt' };
    setupTerminalLinks(term, {
      projectPath: '/wt',
      tabKey: 'p1:wt:/wt',
      workspace: paneWorkspace,
    });

    let links: Array<{ activate: (e: MouseEvent) => void }> | undefined;
    getProvider()!.provideLinks(1, (l) => {
      links = l;
    });
    await links![0].activate({ metaKey: true, button: 0 } as unknown as MouseEvent);

    const space = useEditorStore.getState().tabs['p1:wt:/wt'];
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.workspace).toEqual(
      paneWorkspace,
    );
    expect(readFileContentMock).toHaveBeenCalledWith(paneWorkspace, '/wt/src/main.rs');
  });
});
