// saveTabById / saveFile(tabId) 直接单测：读取 store 内容 → 保存指定 tab。
// 覆盖：命名文件保存成功（清 dirty）、untitled 触发 Save As 不写盘、写盘失败上报。
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTabData, Tab, WorkspaceSession } from '@/shared/types';
import { isFileTab } from '@/shared/utils/fileTree';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { useFileViewTabOps } from '../useFileViewTabOps';

const { requestSaveAsMock, writeFileContentMock } = vi.hoisted(() => ({
  requestSaveAsMock: vi.fn(),
  writeFileContentMock: vi.fn(),
}));

vi.mock('@/features/action-menu/store/saveAsStore', () => ({
  useSaveAsStore: { getState: () => ({ requestSaveAs: requestSaveAsMock }) },
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: vi.fn(),
  writeFileContent: writeFileContentMock,
}));

const MAIN: WorkspaceSession = { projectId: 'p1', worktreePath: null };

function makeFileTab(id: string, overrides: Partial<FileTabData> = {}): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: {
      kind: 'file',
      workspace: MAIN,
      filePath: `${id}.ts`,
      fileName: `${id}.ts`,
      content: { path: `${id}.ts`, content: 'hello', size: 5, is_binary: false },
      isDirty: true,
      ...overrides,
    },
  };
}

function renderOps(setError = vi.fn(), workspaceRef: WorkspaceSession | null = MAIN) {
  return renderHook(() =>
    useFileViewTabOps({
      tabKeyRef: {
        current: workspaceKeyOf(
          workspaceRef?.projectId ?? 'p1',
          workspaceRef?.worktreePath ?? null,
        ),
      },
      workspaceRef: { current: workspaceRef },
      setError,
    }),
  );
}

describe('useFileViewTabOps saveTabById', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    requestSaveAsMock.mockReset();
    writeFileContentMock.mockReset();
  });

  it('命名文件：读取 store 内容保存到指定 tab 并清除 dirty 标记', async () => {
    act(() => {
      useEditorStore.getState().addTab(
        workspaceKeyOf('p1', null),
        makeFileTab('t1', {
          content: { path: 't1.ts', content: 'new content', size: 11, is_binary: false },
        }),
      );
    });
    writeFileContentMock.mockResolvedValue(undefined);

    const { result } = renderOps();
    let saved = false;
    await act(async () => {
      saved = await result.current.saveTabById('t1');
    });

    expect(writeFileContentMock).toHaveBeenCalledWith(
      { projectId: 'p1', worktreePath: null },
      't1.ts',
      'new content',
    );
    expect(saved).toBe(true);
    const tab = useEditorStore
      .getState()
      .tabs[workspaceKeyOf('p1', null)]!.tabs.find((t) => t.id === 't1')!;
    expect(isFileTab(tab)).toBe(true);
    if (isFileTab(tab)) {
      expect(tab.data.isDirty).toBe(false);
      expect(tab.data.content.content).toBe('new content');
    }
  });

  /**
   * 回归（审核 Block 4）：写地址必须 = tab 携带的唯一值 `FileTabData.workspace`。
   * 旧实现从「当前激活视图」的 ref 现场重组地址 —— 后台组保存 / 切换视图后保存
   * 会写错工作树。这里让 tab 属于 worktree 组、视图却指向主仓，断言仍写入 worktree。
   */
  it('worktree 组内的 tab：视图已切回主仓，写地址仍取 tab.workspace（不漂移）', async () => {
    const wt = '/home/u/.neeko/worktrees/fix-1';
    const abs = `${wt}/src/a.ts`;
    const wtWorkspace: WorkspaceSession = { projectId: 'p1', worktreePath: wt };
    act(() => {
      useEditorStore.getState().addTab(
        workspaceKeyOf('p1', wt),
        makeFileTab('a', {
          workspace: wtWorkspace,
          filePath: abs,
          fileName: 'a.ts',
          content: { path: abs, content: 'edit', size: 4, is_binary: false },
        }),
      );
    });
    writeFileContentMock.mockResolvedValue(undefined);

    // 视图（refs）指向主仓；tabKeyRef 指到该 tab 所在的 worktree 组。
    const { result } = renderHook(() =>
      useFileViewTabOps({
        tabKeyRef: { current: workspaceKeyOf('p1', wt) },
        workspaceRef: { current: MAIN },
        setError: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.saveTabById('a');
    });

    expect(writeFileContentMock).toHaveBeenCalledWith(wtWorkspace, abs, 'edit');
  });

  it('untitled tab：saveTabById 触发 Save As 并携带 closeAfterSave: true（关闭确认链路）', async () => {
    act(() => {
      useEditorStore
        .getState()
        .addTab(
          workspaceKeyOf('p1', null),
          makeFileTab('u1', { isUntitled: true, untitledName: 'Untitled-1' }),
        );
    });

    const { result } = renderOps();
    let saved = true;
    await act(async () => {
      saved = await result.current.saveTabById('u1');
    });

    expect(saved).toBe(false);
    expect(requestSaveAsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'u1',
        tabKey: workspaceKeyOf('p1', null),
        content: 'hello',
        defaultFilename: 'Untitled-1',
        closeAfterSave: true,
      }),
    );
    expect(writeFileContentMock).not.toHaveBeenCalled();
  });

  it('untitled tab：Ctrl+S 手动保存（saveFile 无 tabId）不带 closeAfterSave', async () => {
    act(() => {
      useEditorStore
        .getState()
        .addTab(
          workspaceKeyOf('p1', null),
          makeFileTab('u1', { isUntitled: true, untitledName: 'Untitled-1' }),
        );
    });

    const { result } = renderOps();
    let saved = true;
    await act(async () => {
      saved = await result.current.saveFile('hello');
    });

    expect(saved).toBe(false);
    expect(requestSaveAsMock).toHaveBeenCalledTimes(1);
    const req = requestSaveAsMock.mock.calls[0][0];
    expect(req.closeAfterSave).toBeUndefined();
  });

  it('找不到 tab 或非文件 tab：返回 false 且不写盘', async () => {
    act(() => {
      useEditorStore.getState().addTab(workspaceKeyOf('p1', null), {
        id: 'term',
        projectId: 'p1',
        title: 'term',
        order: 0,
        data: { kind: 'terminal', agentId: null, status: 'Idle' },
      });
    });

    const { result } = renderOps();
    let saved = true;
    await act(async () => {
      saved = await result.current.saveTabById('missing');
    });
    expect(saved).toBe(false);

    let termSaved = true;
    await act(async () => {
      termSaved = await result.current.saveTabById('term');
    });
    expect(termSaved).toBe(false);
    expect(writeFileContentMock).not.toHaveBeenCalled();
  });

  it('写盘失败：返回 false 并上报错误', async () => {
    act(() => {
      useEditorStore.getState().addTab(workspaceKeyOf('p1', null), makeFileTab('t1'));
    });
    writeFileContentMock.mockRejectedValue(new Error('disk full'));
    const setError = vi.fn();

    const { result } = renderOps(setError);
    let saved = true;
    await act(async () => {
      saved = await result.current.saveTabById('t1');
    });

    expect(saved).toBe(false);
    expect(setError).toHaveBeenCalledWith('Error: disk full');
  });
});
