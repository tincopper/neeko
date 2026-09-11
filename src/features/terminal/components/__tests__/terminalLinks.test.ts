import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';

const { readFileContentMock, revealInFileManagerMock } = vi.hoisted(() => ({
  readFileContentMock: vi.fn(),
  revealInFileManagerMock: vi.fn(),
}));

vi.mock('../../file/api/fileApi', () => ({
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
    setupTerminalLinks(term, { projectPath: '/repo', tabKey: 'p1', projectId: 'p1' });

    let links: Array<{ activate: (e: MouseEvent) => void }> | undefined;
    getProvider()!.provideLinks(1, (l) => {
      links = l;
    });
    expect(links).toHaveLength(1);

    await links![0].activate({ metaKey: true, button: 0 } as unknown as MouseEvent);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].id).toBe('p1:/repo/src/main.rs');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('相对路径（反斜杠分段）→ 拼项目根并统一斜杠 canonical', async () => {
    const { term, getProvider } = makeFakeTerm('Build src\\main.rs failed');
    setupTerminalLinks(term, { projectPath: '/repo', tabKey: 'p1', projectId: 'p1' });

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
