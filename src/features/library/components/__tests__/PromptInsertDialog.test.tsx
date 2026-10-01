import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import type { PromptResource } from '@/shared/types/library';

import PromptInsertDialog from '../PromptInsertDialog';

const listPrompts = vi.hoisted(() => vi.fn());
const onInsert = vi.fn();

vi.mock('@/features/library/api/libraryApi', () => ({
  listPrompts: () => listPrompts(),
  savePrompt: vi.fn(),
  updatePrompt: vi.fn(),
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
    ...over,
  };
}

const REVIEW = promptFixture({
  id: 'p1',
  name: 'Review',
  description: 'Code Review Checklist',
  slash: 'review',
  tags: ['git'],
});
const PLAN = promptFixture({ id: 'p2', name: 'Plan' });
const SHIP = promptFixture({ id: 'p3', name: 'Ship' });

const ROW_TITLE = 'Left-click: insert to agent · Right-click / Shift+Enter: insert to terminal';

function open(prompts: PromptResource[]) {
  useLibraryStore.setState({ prompts, insertOpen: true });
  return render(<PromptInsertDialog onInsert={onInsert} />);
}

function searchInput(): HTMLElement {
  return screen.getByPlaceholderText(/Search prompts/) as HTMLElement;
}

/** 行按钮 title 相同，按行内标题文本回溯到所在按钮。 */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('button') as HTMLElement;
}

function isHighlighted(name: string): boolean {
  return rowOf(name).className.includes('bg-accent-blue');
}

describe('PromptInsertDialog', () => {
  beforeEach(() => {
    resetLibraryState();
    onInsert.mockClear();
    listPrompts.mockReset();
    listPrompts.mockResolvedValue([]);
  });

  it('打开时 prompts 为空则拉取一次', async () => {
    open([]);

    await screen.findByText('No prompts yet');
    expect(listPrompts).toHaveBeenCalledTimes(1);
  });

  it('已缓存 prompts 时不重复拉取', () => {
    open([REVIEW]);

    expect(listPrompts).not.toHaveBeenCalled();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('有查询但无命中显示 No matches', () => {
    open([REVIEW]);

    fireEvent.change(searchInput(), { target: { value: 'zzz' } });

    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('过滤走唯一产出点：description / tags 同样命中', () => {
    open([REVIEW, PLAN]);

    fireEvent.change(searchInput(), { target: { value: 'checklist' } });
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();

    fireEvent.change(searchInput(), { target: { value: 'git' } });
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('结果截断到 20 条', () => {
    open(Array.from({ length: 25 }, (_, i) => promptFixture({ id: `x${i}`, name: `P${i}` })));

    expect(screen.getAllByTitle(ROW_TITLE)).toHaveLength(20);
  });

  it('↑↓ 移动高亮，到尾回绕到首项，首项 ArrowUp 回绕到末项', () => {
    open([REVIEW, PLAN, SHIP]);
    const search = searchInput();

    expect(isHighlighted('Review')).toBe(true);

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(isHighlighted('Review')).toBe(false);
    expect(isHighlighted('Plan')).toBe(true);

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(isHighlighted('Review')).toBe(true);

    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(isHighlighted('Ship')).toBe(true);
  });

  /**
   * 投递即关闭选择器（见「投递前先关闭」用例），所以每个目标各起一次渲染 ——
   * 同一个实例里连按两次键盘，第二次已经没有对话框可接收了。
   */
  it('Enter 投递高亮项到 agent', () => {
    open([REVIEW, PLAN]);
    const search = searchInput();

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onInsert).toHaveBeenCalledWith(PLAN, 'agent');
  });

  it('Shift+Enter 投递高亮项到 terminal', () => {
    open([REVIEW, PLAN]);
    const search = searchInput();

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });

    expect(onInsert).toHaveBeenCalledWith(PLAN, 'terminal');
  });

  it('左键投递所在行而非高亮项', () => {
    open([REVIEW, PLAN, SHIP]);

    fireEvent.click(rowOf('Ship'));

    expect(onInsert).toHaveBeenCalledWith(SHIP, 'agent');
  });

  it('右键投递所在行到 terminal', () => {
    open([REVIEW, PLAN, SHIP]);

    fireEvent.contextMenu(rowOf('Plan'));

    expect(onInsert).toHaveBeenCalledWith(PLAN, 'terminal');
  });

  it('投递前先关闭选择器（避免与变量表单同帧互抢焦点陷阱）', () => {
    open([REVIEW]);

    fireEvent.click(rowOf('Review'));

    expect(useLibraryStore.getState().insertOpen).toBe(false);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('无命中时 Enter 不投递也不关闭', () => {
    open([REVIEW]);

    fireEvent.change(searchInput(), { target: { value: 'zzz' } });
    fireEvent.keyDown(searchInput(), { key: 'Enter' });

    expect(onInsert).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().insertOpen).toBe(true);
  });

  it('Escape 关闭且不投递', () => {
    open([REVIEW]);

    fireEvent.keyDown(searchInput(), { key: 'Escape' });

    expect(useLibraryStore.getState().insertOpen).toBe(false);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('清空按钮丢弃查询词', () => {
    open([REVIEW, PLAN]);
    fireEvent.change(searchInput(), { target: { value: 'pla' } });
    expect(screen.queryByText('Review')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(searchInput()).toHaveValue('');
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('鼠标移入把高亮移到该行，随后 Enter 投递该行', () => {
    open([REVIEW, PLAN]);

    fireEvent.mouseEnter(rowOf('Plan'));
    fireEvent.keyDown(searchInput(), { key: 'Enter' });

    expect(onInsert).toHaveBeenCalledWith(PLAN, 'agent');
  });

  it('查询变化时高亮回到首项', () => {
    open([REVIEW, PLAN, SHIP]);
    const search = searchInput();

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(isHighlighted('Plan')).toBe(true);

    fireEvent.change(search, { target: { value: 'hip' } });

    // 只剩 Ship，且它成为高亮首项（索引归零，不是沿用旧索引指向空位）。
    expect(screen.getAllByTitle(ROW_TITLE)).toHaveLength(1);
    expect(isHighlighted('Ship')).toBe(true);
  });
});
