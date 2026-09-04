// SaveFileDialog：closeAfterSave 闭环 —— 保存成功且带标记 → 自动关 tab；
// 取消 / 保存失败 / 未带标记 → 不关。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTabData, Tab } from '@/shared/types';
import type { Project } from '@/shared/types/project';

const { saveNewFileMock, closeEditorTabMock } = vi.hoisted(() => ({
  saveNewFileMock: vi.fn(),
  closeEditorTabMock: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readDirTree: vi.fn(() => Promise.resolve([])),
  saveNewFile: saveNewFileMock,
}));
vi.mock('@/features/git', () => ({ refreshGitFileStates: vi.fn() }));
vi.mock('@/features/terminal', () => ({ closeEditorTab: closeEditorTabMock }));

import { useSaveAsStore, type SaveAsRequest } from '../../store/saveAsStore';
import SaveFileDialog from '../SaveFileDialog';

const activeProject = {
  id: 'p1',
  name: 'p1',
  path: '/repo',
  git_info: null,
  selected_agents: [],
  selected_ide: null,
  active_view: 'Terminal',
  collapsed: false,
} as Project;

function makeUntitledTab(id: string, overrides: Partial<FileTabData> = {}): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: id,
      fileName: id,
      content: { path: id, content: 'hello', size: 5, is_binary: false },
      isDirty: true,
      ...overrides,
    },
  };
}

function makeRequest(overrides: Partial<SaveAsRequest> = {}): SaveAsRequest {
  return {
    tabId: 'u1',
    tabKey: 'p1',
    projectId: 'p1',
    content: 'hello',
    defaultDirectory: '/repo',
    defaultFilename: 'Untitled-1',
    ...overrides,
  };
}

function renderDialog(req: SaveAsRequest | null) {
  act(() => {
    useSaveAsStore.setState({ request: req });
  });
  return render(<SaveFileDialog />);
}

describe('SaveFileDialog closeAfterSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject });
    saveNewFileMock.mockResolvedValue('notes/Untitled-1.ts');
  });

  it('保存成功且 closeAfterSave=true → 自动关闭该 tab', async () => {
    act(() => {
      useEditorStore.getState().addTab('p1', makeUntitledTab('u1', { untitledName: 'Untitled-1' }));
    });
    renderDialog(makeRequest({ closeAfterSave: true }));

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(closeEditorTabMock).toHaveBeenCalledWith('p1', 'u1');
    });
    expect(saveNewFileMock).toHaveBeenCalledWith('p1', '/repo', 'Untitled-1', 'hello', undefined);
    // 保存成功 → tab 转为 named file 且清 dirty，再被关闭
    const tab = useEditorStore.getState().tabs['p1']!.tabs.find((t) => t.id === 'u1');
    expect(tab && tab.data.kind === 'file' && tab.data.isDirty).toBe(false);
    // 对话框请求已消费
    expect(useSaveAsStore.getState().request).toBeNull();
  });

  it('保存成功但未带 closeAfterSave（Ctrl+S 链路）→ 不关 tab', async () => {
    renderDialog(makeRequest());

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(useSaveAsStore.getState().request).toBeNull();
    });
    expect(closeEditorTabMock).not.toHaveBeenCalled();
  });

  it('取消 Save As → 不关 tab，请求清除', async () => {
    renderDialog(makeRequest({ closeAfterSave: true }));

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useSaveAsStore.getState().request).toBeNull();
    expect(closeEditorTabMock).not.toHaveBeenCalled();
    expect(saveNewFileMock).not.toHaveBeenCalled();
  });

  it('保存失败 → 不关 tab，显示错误', async () => {
    saveNewFileMock.mockRejectedValue(new Error('disk full'));
    renderDialog(makeRequest({ closeAfterSave: true }));

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('disk full')).toBeInTheDocument();
    });
    expect(closeEditorTabMock).not.toHaveBeenCalled();
  });
});
