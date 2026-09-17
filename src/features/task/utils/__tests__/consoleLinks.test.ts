import { fireEvent } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';

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

describe('consoleLinks — worktree 键空间（resolveTabKey 派生）', () => {
  const WT_KEY = 'p1:wt:/repo/.wt/feat';
  const TAB_ID_WT = `${WT_KEY}:/repo/src/main.rs`;

  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null, navigateGoal: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => ({
      path: p,
      content: 'x',
      size: 1,
      is_binary: false,
    }));
  });

  /** 构造终端并点击第 1 行中 /repo/src/main.rs 链接（metaKey → 打开编辑器）。
   *  行列号用 `(10,2)` 括号格式 —— FILE_PATH_REGEX 仅在括号包裹时捕获 line/col，
   *  裸 `path:10:2` 后缀不捕获（line 为 undefined → 不写 goal）。 */
  function clickMainRsLink() {
    const lineText = 'error at /repo/src/main.rs(10,2)';
    const { term, container } = makeFakeTerm(lineText);
    setupConsoleLinks(term, { projectPath: '/repo', projectId: 'p1' });
    const matchIndex = lineText.indexOf('/repo/src/main.rs');
    fireEvent.mouseDown(container, {
      button: 0,
      clientX: clientXForColumn(matchIndex + 2),
      clientY: 5,
      metaKey: true,
    });
  }

  it('worktree 激活 → tab 落 worktree 键空间且 navigateGoal 写同键空间', async () => {
    useWorktreeStore.setState({ activeWorktreePath: '/repo/.wt/feat' });
    clickMainRsLink();

    await vi.waitFor(() => {
      // tab 落 worktree 键空间
      const wt = useEditorStore.getState().tabs[WT_KEY];
      expect(wt?.tabs[0]?.id).toBe(TAB_ID_WT);
      // 不污染基础键空间
      expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
      // goal 与 tab 同键空间（键空间自洽，R4）
      expect(useEditorStore.getState().navigateGoal).toMatchObject({
        tabKey: WT_KEY,
        tabId: TAB_ID_WT,
        line: 10,
        col: 2,
      });
    });
  });

  it('worktree 未激活 → tab 与 navigateGoal 落基础键空间（回归）', async () => {
    clickMainRsLink();

    await vi.waitFor(() => {
      const base = useEditorStore.getState().tabs['p1'];
      expect(base?.tabs[0]?.id).toBe('p1:/repo/src/main.rs');
      expect(useEditorStore.getState().navigateGoal).toMatchObject({
        tabKey: 'p1',
        tabId: 'p1:/repo/src/main.rs',
        line: 10,
        col: 2,
      });
    });
  });

  it('worktree 激活且 tab 已在 worktree 空间打开 → 只激活不重复建 tab，goal 同键空间', async () => {
    useWorktreeStore.setState({ activeWorktreePath: '/repo/.wt/feat' });
    useEditorStore.setState({
      tabs: {
        [WT_KEY]: {
          tabs: [
            {
              id: TAB_ID_WT,
              projectId: 'p1',
              title: 'main.rs',
              order: 0,
              data: {
                kind: 'file',
                filePath: '/repo/src/main.rs',
                fileName: 'main.rs',
                content: 'x',
                isDirty: false,
              },
            },
          ],
          activeTabId: TAB_ID_WT,
        },
      },
      editorLayout: {},
      activeTabId: TAB_ID_WT,
    });

    clickMainRsLink();

    await vi.waitFor(() => {
      // existing 分支：activateTab + setNavigateGoal，不重复建 tab
      expect(useEditorStore.getState().tabs[WT_KEY]?.tabs).toHaveLength(1);
      expect(readFileContentMock).not.toHaveBeenCalled();
      expect(useEditorStore.getState().navigateGoal).toMatchObject({
        tabKey: WT_KEY,
        tabId: TAB_ID_WT,
        line: 10,
        col: 2,
      });
    });
  });
});
