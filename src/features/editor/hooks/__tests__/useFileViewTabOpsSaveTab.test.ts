// saveTabById / saveFile(tabId) 直接单测：读取 store 内容 → 保存指定 tab。
// 覆盖：命名文件保存成功（清 dirty）、untitled 触发 Save As 不写盘、写盘失败上报。
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTabData, Tab } from '@/shared/types';
import { isFileTab } from '@/shared/utils/fileTree';

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

function makeFileTab(id: string, overrides: Partial<FileTabData> = {}): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: `${id}.ts`,
      fileName: `${id}.ts`,
      content: { path: `${id}.ts`, content: 'hello', size: 5, is_binary: false },
      isDirty: true,
      ...overrides,
    },
  };
}

function renderOps(setError = vi.fn()) {
  return renderHook(() =>
    useFileViewTabOps({
      tabKeyRef: { current: 'p1' },
      worktreePathRef: { current: null },
      externalCommandsRef: { current: null },
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
        'p1',
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

    expect(writeFileContentMock).toHaveBeenCalledWith('p1', 't1.ts', 'new content');
    expect(saved).toBe(true);
    const tab = useEditorStore.getState().tabs['p1']!.tabs.find((t) => t.id === 't1')!;
    expect(isFileTab(tab)).toBe(true);
    if (isFileTab(tab)) {
      expect(tab.data.isDirty).toBe(false);
      expect(tab.data.content.content).toBe('new content');
    }
  });

  it('untitled tab：触发 Save As 对话框、不写盘、返回 false', async () => {
    act(() => {
      useEditorStore
        .getState()
        .addTab('p1', makeFileTab('u1', { isUntitled: true, untitledName: 'Untitled-1' }));
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
        tabKey: 'p1',
        content: 'hello',
        defaultFilename: 'Untitled-1',
      }),
    );
    expect(writeFileContentMock).not.toHaveBeenCalled();
  });

  it('找不到 tab 或非文件 tab：返回 false 且不写盘', async () => {
    act(() => {
      useEditorStore.getState().addTab('p1', {
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
      useEditorStore.getState().addTab('p1', makeFileTab('t1'));
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
