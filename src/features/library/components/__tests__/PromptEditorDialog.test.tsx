import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { PromptResource } from '@/shared/types/library';

import PromptEditorDialog from '../PromptEditorDialog';

const savePrompt = vi.hoisted(() => vi.fn());
const updatePrompt = vi.hoisted(() => vi.fn());

vi.mock('@/features/library/api/libraryApi', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
  savePrompt: (...args: unknown[]) => savePrompt(...args),
  updatePrompt: (...args: unknown[]) => updatePrompt(...args),
  deletePrompt: vi.fn(),
  recordPromptUsage: vi.fn(),
}));

function promptFixture(over: Partial<PromptResource> & { id: string }): PromptResource {
  return {
    name: `prompt-${over.id}`,
    description: null,
    content: `content-${over.id}`,
    slash: null,
    tags: [],
    scope: 'global',
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 2,
    variables: [],
    ...over,
  };
}

const refreshPrompts = vi.fn(async (): Promise<void> => {});

function openEditor(editing: PromptResource | null = null) {
  useLibraryStore.setState({
    editorOpen: true,
    editorKind: 'prompt',
    editingPrompt: editing,
    refreshPrompts,
  });
  return render(<PromptEditorDialog />);
}

const nameInput = () => screen.getByLabelText('Name') as HTMLElement;
const contentInput = () => screen.getByLabelText('Content') as HTMLElement;
const variablesInput = () => screen.getByPlaceholderText(/^\[\{/) as HTMLElement;

describe('PromptEditorDialog', () => {
  beforeEach(() => {
    resetLibraryState();
    savePrompt.mockReset();
    updatePrompt.mockReset();
    refreshPrompts.mockClear();
    savePrompt.mockResolvedValue(undefined);
    updatePrompt.mockResolvedValue(undefined);
    useProjectStore.setState({ activeProject: null, activeProjectId: 'proj-1' });
  });

  it('name 为空时拒绝保存，并给出字段级错误', () => {
    openEditor();
    fireEvent.change(contentInput(), { target: { value: 'do the thing' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(savePrompt).not.toHaveBeenCalled();
  });

  it('content 为空时拒绝保存', () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'Review' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    expect(screen.getByText('Content is required')).toBeInTheDocument();
    expect(savePrompt).not.toHaveBeenCalled();
  });

  it('新建：解析 tags / 变量 / 空串回 null，保存后刷新并关闭', async () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: '  Review  ' } });
    fireEvent.change(contentInput(), { target: { value: '  hi {{name}}  ' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'git, review,' } });
    fireEvent.change(variablesInput(), {
      target: { value: '[{"name":"name","description":"Who","default":"tom","required":true}]' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalledTimes(1));
    expect(savePrompt).toHaveBeenCalledWith({
      name: 'Review',
      description: null,
      content: 'hi {{name}}',
      slash: null,
      tags: ['git', 'review'],
      scope: 'global',
      projectId: null,
      kind: 'prompt',
      variables: [{ name: 'name', description: 'Who', default: 'tom', required: true }],
    });
    expect(refreshPrompts).toHaveBeenCalled();
    expect(useLibraryStore.getState().editorOpen).toBe(false);
  });

  it('变量写逗号名单（非 JSON）时回退成名字数组', async () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });
    fireEvent.change(contentInput(), { target: { value: 'body' } });
    fireEvent.change(variablesInput(), { target: { value: 'branch, projectPath' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalled());
    expect(savePrompt.mock.calls[0][0].variables).toEqual([
      { name: 'branch', required: false },
      { name: 'projectPath', required: false },
    ]);
  });

  it('slash 输入丢弃非法字符，保存时带上裸词', async () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });
    fireEvent.change(contentInput(), { target: { value: 'body' } });
    fireEvent.change(screen.getByLabelText('Slash command'), {
      target: { value: 'code review!' },
    });

    expect(screen.getByLabelText('Slash command')).toHaveValue('codereview');

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalled());
    expect(savePrompt.mock.calls[0][0].slash).toBe('codereview');
  });

  it('scope=project 时带上当前项目 id', async () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });
    fireEvent.change(contentInput(), { target: { value: 'body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalled());
    expect(savePrompt.mock.calls[0][0]).toMatchObject({ scope: 'project', projectId: 'proj-1' });
  });

  it('无激活项目时选 Project 给出警示文案（不是静默不可用）', () => {
    useProjectStore.setState({ activeProjectId: null });
    openEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    expect(screen.getByText('Select a project to scope this prompt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute(
      'title',
      'Select a project first',
    );
  });

  it('Type 切到 command 时说明文案与 payload 一起跟随', async () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });
    fireEvent.change(contentInput(), { target: { value: 'body' } });

    fireEvent.click(screen.getByRole('button', { name: 'Command' }));
    expect(screen.getByText(/deploy to agent command directories/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalled());
    expect(savePrompt.mock.calls[0][0].kind).toBe('command');
  });

  it('编辑：预填既有值，保存走 update 并保留 favorite', async () => {
    const editing = promptFixture({
      id: 'p1',
      name: 'Review',
      description: 'Checklist',
      content: 'hi {{name}}',
      slash: 'review',
      tags: ['git'],
      scope: 'project',
      favorite: true,
      variables: [{ name: 'name', required: false }],
    });
    openEditor(editing);

    expect(nameInput()).toHaveValue('Review');
    expect(screen.getByLabelText('Description')).toHaveValue('Checklist');
    expect(screen.getByLabelText('Tags')).toHaveValue('git');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();

    fireEvent.change(contentInput(), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updatePrompt).toHaveBeenCalledTimes(1));
    expect(updatePrompt).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ favorite: true, content: 'changed', name: 'Review' }),
    );
    expect(savePrompt).not.toHaveBeenCalled();
  });

  it('保存失败：显示错误、按钮恢复可用、对话框不关（不吞掉用户输入）', async () => {
    savePrompt.mockRejectedValueOnce(new Error('disk full'));
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });
    fireEvent.change(contentInput(), { target: { value: 'body' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Prompt' }));

    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Prompt' })).toBeEnabled();
    expect(useLibraryStore.getState().editorOpen).toBe(true);
    expect(refreshPrompts).not.toHaveBeenCalled();
  });

  it('取消：关闭编辑器且不落盘', () => {
    openEditor();
    fireEvent.change(nameInput(), { target: { value: 'A' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useLibraryStore.getState().editorOpen).toBe(false);
    expect(savePrompt).not.toHaveBeenCalled();
  });

  it('新建态标题是 New Prompt（编辑态标题已由 Save Changes 用例覆盖）', () => {
    openEditor();

    expect(screen.getByText('New Prompt')).toBeInTheDocument();
  });
});
