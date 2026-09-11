import { fireEvent } from '@testing-library/react';
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

import { setupConsoleLinks } from '../consoleLinks';

/** 80 列 × 10 行 × 10px/列 × 20px/行 的假终端；lineText 渲染在第 1 行。 */
function makeFakeTerm(lineText: string) {
  const container = document.createElement('div');
  const rows = document.createElement('div');
  rows.className = 'xterm-rows';
  Object.defineProperty(rows, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 200 }),
  });
  container.appendChild(rows);
  document.body.appendChild(container);

  const term = {
    element: container,
    cols: 80,
    rows: 10,
    buffer: {
      active: {
        viewportY: 0,
        getLine: (n: number) => (n === 0 ? { translateToString: () => lineText } : undefined),
      },
    },
    registerLinkProvider: vi.fn(),
  };
  return { term: term as unknown as Terminal, container };
}

/** 计算 1-based 列号对应的 clientX（cell 宽 10px）。 */
function clientXForColumn(column: number): number {
  return (column - 1) * 10 + 5;
}

describe('consoleLinks — 文件路径 Ctrl/Cmd+Click 打开编辑器（canonical 构造）', () => {
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
    const lineText = 'error at /repo/src/main.rs:10:2';
    const { term, container } = makeFakeTerm(lineText);
    setupConsoleLinks(term, { projectPath: '/repo', projectId: 'p1' });

    // 命中路径中段（match.index+1 起）
    const matchIndex = lineText.indexOf('/repo/src/main.rs');
    const clientX = clientXForColumn(matchIndex + 2);
    fireEvent.mouseDown(container, { button: 0, clientX, clientY: 5, metaKey: true });

    await vi.waitFor(() => {
      const space = useEditorStore.getState().tabs['p1'];
      expect(space.tabs[0].id).toBe('p1:/repo/src/main.rs');
      expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
        '/repo/src/main.rs',
      );
    });
  });

  it('相对路径（反斜杠分段）→ 拼项目根并统一斜杠 canonical', async () => {
    const lineText = 'build src\\main.rs ok';
    const { term, container } = makeFakeTerm(lineText);
    setupConsoleLinks(term, { projectPath: '/repo', projectId: 'p1' });

    const matchIndex = lineText.indexOf('src\\main.rs');
    const clientX = clientXForColumn(matchIndex + 2);
    fireEvent.mouseDown(container, { button: 0, clientX, clientY: 5, metaKey: true });

    await vi.waitFor(() => {
      const space = useEditorStore.getState().tabs['p1'];
      expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
        '/repo/src/main.rs',
      );
    });
  });
});
