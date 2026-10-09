/**
 * useFileTabRefresh —— 历史 bug 首通道（任务验收「自动刷新读对单元」的回归钉）。
 *
 * 钉三件事：
 * 1. 事件 `workspace_key` 只作 **tab 组索引**（不解析还原身份）；
 * 2. 读取地址 = `tab.data.workspace`（值携带）——主仓组里同路径文件**不得**被
 *    worktree 事件触发（worktree 激活时读错单元正是原始症状）；
 * 3. 命中判定走 `pathsContainFile`（相对该单元工作树根；绝对路径回退也命中）。
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent, WorkspaceSession } from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

const { readFileContentMock } = vi.hoisted(() => ({ readFileContentMock: vi.fn() }));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
}));

let capturedHandler: ((event: FileChangedEvent) => void | Promise<void>) | null = null;
vi.mock('@/features/git', () => ({
  useFileChangedEvent: (cb: (event: FileChangedEvent) => void | Promise<void>) => {
    capturedHandler = cb;
  },
}));

import { useFileTabRefresh } from '../useFileTabRefresh';

const WT: WorkspaceSession = { projectId: 'p1', worktreePath: '/wt' };
const MAIN: WorkspaceSession = { projectId: 'p1', worktreePath: null };

function makeFileTab(id: string, workspace: WorkspaceSession, filePath: string, isDirty = false) {
  return {
    id,
    projectId: workspace.projectId,
    title: id,
    order: 0,
    data: {
      kind: 'file' as const,
      workspace,
      filePath,
      fileName: `${id}.ts`,
      content: { path: filePath, content: 'old', size: 3, is_binary: false },
      isDirty,
    },
  };
}

async function fire(event: FileChangedEvent) {
  await capturedHandler!(event);
  // 等微任务队列（handler 内 await readFileContent 之后的 updateTab）
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  capturedHandler = null;
  vi.clearAllMocks();
  readFileContentMock.mockResolvedValue({ content: 'new', size: 3, is_binary: false });
  useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'p1', path: '/repo' } as never],
    activeProjectId: 'p1',
  });
  renderHook(() => useFileTabRefresh());
  expect(capturedHandler).not.toBeNull();
});

describe('useFileTabRefresh — 按 Workspace 定址刷新', () => {
  it('worktree 事件只刷新该单元组，读取地址 = tab.workspace（值携带）', async () => {
    useEditorStore
      .getState()
      .addTab(workspaceKeyOf('p1', '/wt'), makeFileTab('wt-a', WT, '/wt/src/a.ts'));
    useEditorStore
      .getState()
      .addTab(workspaceKeyOf('p1', null), makeFileTab('main-a', MAIN, '/repo/src/a.ts'));

    await fire({
      project_id: 'p1',
      workspace_key: String(workspaceKeyOf('p1', '/wt')),
      paths: ['src/a.ts'],
    });

    // 只读 worktree 组的那个 tab；地址是携带值，不从事件 key 解析
    expect(readFileContentMock).toHaveBeenCalledTimes(1);
    expect(readFileContentMock).toHaveBeenCalledWith(WT, '/wt/src/a.ts');
    const wtTab = useEditorStore.getState().tabs[String(workspaceKeyOf('p1', '/wt'))].tabs[0];
    if (wtTab.data.kind === 'file') expect(wtTab.data.content.content).toBe('new');
    // 主仓组同路径文件不受波及（旧症状：worktree 改动刷新错单元）
    const mainTab = useEditorStore.getState().tabs[String(workspaceKeyOf('p1', null))].tabs[0];
    if (mainTab.data.kind === 'file') expect(mainTab.data.content.content).toBe('old');
  });

  it('dirty tab 命中 → 只标 externallyModified，不读盘', async () => {
    useEditorStore
      .getState()
      .addTab(workspaceKeyOf('p1', null), makeFileTab('m', MAIN, '/repo/src/a.ts', true));

    await fire({
      project_id: 'p1',
      workspace_key: String(workspaceKeyOf('p1', null)),
      paths: ['src/a.ts'],
    });

    expect(readFileContentMock).not.toHaveBeenCalled();
    const tab = useEditorStore.getState().tabs[String(workspaceKeyOf('p1', null))].tabs[0];
    if (tab.data.kind === 'file') expect(tab.data.externallyModified).toBe(true);
  });

  it('绝对路径回退（strip_prefix 失败）同样命中', async () => {
    useEditorStore
      .getState()
      .addTab(workspaceKeyOf('p1', '/wt'), makeFileTab('wt-a', WT, '/wt/src/a.ts'));

    await fire({
      project_id: 'p1',
      workspace_key: String(workspaceKeyOf('p1', '/wt')),
      paths: ['/wt/src/a.ts'],
    });

    expect(readFileContentMock).toHaveBeenCalledWith(WT, '/wt/src/a.ts');
  });

  it('未命中路径 → 不读盘不更新', async () => {
    useEditorStore
      .getState()
      .addTab(workspaceKeyOf('p1', null), makeFileTab('m', MAIN, '/repo/src/a.ts'));

    await fire({
      project_id: 'p1',
      workspace_key: String(workspaceKeyOf('p1', null)),
      paths: ['src/b.ts'],
    });

    expect(readFileContentMock).not.toHaveBeenCalled();
  });
});
