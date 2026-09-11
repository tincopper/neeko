// SaveFileDialog：closeAfterSave 闭环 —— 保存成功且带标记 → 自动关 tab；
// 取消 / 保存失败 / 未带标记 → 不关。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
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
vi.mock('@/features/terminal', () => ({
  // 忠实模拟真实 closeEditorTab（terminalTabCleanup）：PTY 清理 + 从 store 移除 tab。
  // 测试需观察 store 级关闭效果（源 tab 移除 / 目标 id 唯一），纯记录式 mock 不够。
  closeEditorTab: closeEditorTabMock.mockImplementation((projectId: string, tabId: string) => {
    useEditorStore.getState().closeTab(projectId, tabId);
  }),
}));

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
    useWorktreeStore.setState({ activeWorktreePath: null });
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
      // Save As 是身份迁移：tab.id 同步改为 getTabId(tabKey, canonical path)，
      // 关闭清理也以新 id 触发（旧实现只改 filePath 不改 id —— 身份脱钩 bug）。
      expect(closeEditorTabMock).toHaveBeenCalledWith('p1', 'p1:/repo/notes/Untitled-1.ts');
    });
    expect(saveNewFileMock).toHaveBeenCalledWith('p1', '/repo', 'Untitled-1', 'hello', undefined);
    // 关闭确认链路：保存成功 → 迁移到 canonical id 后按新 id 关闭，旧/新 id 均不残留
    expect(
      useEditorStore
        .getState()
        .tabs['p1']!.tabs.some((t) => t.id === 'p1:/repo/notes/Untitled-1.ts'),
    ).toBe(false);
    expect(useEditorStore.getState().tabs['p1']!.tabs.some((t) => t.id === 'u1')).toBe(false);
    // 对话框请求已消费
    expect(useSaveAsStore.getState().request).toBeNull();
  });

  it('保存成功但未带 closeAfterSave（Ctrl+S 链路）→ 不关 tab，且 id 已迁移', async () => {
    act(() => {
      useEditorStore.getState().addTab('p1', makeUntitledTab('u1', { untitledName: 'Untitled-1' }));
    });
    renderDialog(makeRequest());

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(useSaveAsStore.getState().request).toBeNull();
    });
    expect(closeEditorTabMock).not.toHaveBeenCalled();
    // 身份迁移后 tab 保持激活（activateTab 以新 id 命中）
    expect(useEditorStore.getState().tabs['p1']!.activeTabId).toBe('p1:/repo/notes/Untitled-1.ts');
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

  it('worktree 激活：canonical 根对齐 worktree（与 saveNewFile 的 resolve_base 一致）', async () => {
    useWorktreeStore.setState({ activeWorktreePath: '/wt' });
    act(() => {
      useEditorStore.getState().addTab('p1', makeUntitledTab('u1', { untitledName: 'Untitled-1' }));
    });
    renderDialog(makeRequest());

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveNewFileMock).toHaveBeenCalledWith('p1', '/repo', 'Untitled-1', 'hello', '/wt');
    });
    expect(
      useEditorStore.getState().tabs['p1']!.tabs.some((t) => t.id === 'p1:/wt/notes/Untitled-1.ts'),
    ).toBe(true);
  });

  it('Save As 目标路径已在另一 tab 打开（id 冲突）→ 关源 tab、激活既有 tab、不残留脱钩 tab', async () => {
    // 目标 canonical id 已被既有 tab 占用 → renameTab 必然拒绝迁移；磁盘已被
    // 新内容覆盖，若仍走 updateTab+renameTab 会残留 id='u1'/filePath='/repo/…'
    // 的脱钩 tab，且 close/activate 落到错误的既有 tab。
    act(() => {
      useEditorStore.getState().addTab('p1', {
        id: 'p1:/repo/notes/Untitled-1.ts',
        projectId: 'p1',
        title: 'Untitled-1.ts',
        order: 0,
        data: {
          kind: 'file',
          filePath: '/repo/notes/Untitled-1.ts',
          fileName: 'Untitled-1.ts',
          content: { path: '/repo/notes/Untitled-1.ts', content: 'old', size: 3, is_binary: false },
          isDirty: false,
        },
      });
      useEditorStore.getState().addTab('p1', makeUntitledTab('u1', { untitledName: 'Untitled-1' }));
    });
    renderDialog(makeRequest());

    await screen.findByDisplayValue('Untitled-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(useSaveAsStore.getState().request).toBeNull();
    });
    // 源 untitled tab 被关闭，不残留脱钩 tab
    expect(useEditorStore.getState().tabs['p1']!.tabs.some((t) => t.id === 'u1')).toBe(false);
    // 既有目标 tab 被激活（非重复新 tab）
    expect(useEditorStore.getState().tabs['p1']!.activeTabId).toBe('p1:/repo/notes/Untitled-1.ts');
    expect(
      useEditorStore
        .getState()
        .tabs['p1']!.tabs.filter((t) => t.id === 'p1:/repo/notes/Untitled-1.ts'),
    ).toHaveLength(1);
    expect(closeEditorTabMock).toHaveBeenCalledWith('p1', 'u1');
  });
});
