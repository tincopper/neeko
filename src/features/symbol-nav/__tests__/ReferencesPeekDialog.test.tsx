/**
 * ReferencesPeekDialog：左列表右预览 + 键盘导航 + 空态。
 * store 经 setState 预置，不触网络。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferencesPeekDialog } from '../ReferencesPeekDialog';
import { useReferencesPeekStore } from '../store/referencesPeekStore';

vi.mock('@/features/quick-open', () => ({
  openProjectFile: vi.fn(async () => undefined),
}));

vi.mock('@/shared/utils/codemirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/codemirror')>();
  return {
    ...actual,
    getCachedLanguageExtension: () => null,
    getLanguageExtension: vi.fn(async () => null),
  };
});

const navigate = vi.fn(async () => undefined);

function seed() {
  useReferencesPeekStore.setState({
    open: true,
    title: 'References: myFn (2)',
    loading: false,
    truncated: false,
    projectId: 'p1',
    navigate,
    selectedIndex: 1,
    groups: [
      {
        uri: 'file:///proj/a.go',
        filePath: '/proj/a.go',
        items: [
          {
            id: 'peek-0',
            filePath: '/proj/a.go',
            snippet: '\tsub, ok := myFn(os.Args)',
            previewLines: ['package main', '\tsub, ok := myFn(os.Args)', '\tfmt.Println(sub)'],
            previewBaseLine0: 0,
            previewMatchIdx: 1,
            matchStartChar: 12,
            matchEndChar: 16,
            location: {
              uri: 'file:///proj/a.go',
              range: { start: { line: 1, character: 4 }, end: { line: 1, character: 8 } },
            },
          },
        ],
      },
      {
        uri: 'file:///proj/b.go',
        filePath: '/proj/b.go',
        items: [
          {
            id: 'peek-1',
            filePath: '/proj/b.go',
            snippet: 'got := myFn(x)',
            previewLines: ['got := myFn(x)', 'check(got)'],
            previewBaseLine0: 5,
            previewMatchIdx: 0,
            matchStartChar: 7,
            matchEndChar: 11,
            location: {
              uri: 'file:///proj/b.go',
              range: { start: { line: 5, character: 1 }, end: { line: 5, character: 5 } },
            },
          },
        ],
      },
    ],
  });
}

describe('ReferencesPeekDialog', () => {
  beforeEach(() => {
    useReferencesPeekStore.getState().close();
  });

  it('should_render_groups_snippets_and_selected_preview', async () => {
    seed();
    render(<ReferencesPeekDialog />);
    // 标题同时存在于 sr-only DialogTitle 与可见头（无障碍 + 视觉各一处）
    expect(screen.getAllByText('References: myFn (2)')).toHaveLength(2);
    // 组头：文件名加粗 + 目录灰字（分属两片）
    expect(screen.getByText('a.go')).toBeInTheDocument();
    expect(screen.getByText('b.go')).toBeInTheDocument();
    // 右预览（只读 CM，异步挂载）显示选中项（第 2 条）上下文
    expect(await screen.findByTestId('peek-preview')).toHaveTextContent('check(got)');
    // 命中词高亮
    expect(await screen.findByTestId('peek-match')).toHaveTextContent('myFn');
  });

  it('should_focus_list_on_open_so_arrows_and_enter_reach_the_dialog', async () => {
    seed();
    render(<ReferencesPeekDialog />);
    // 打开后焦点必须在弹窗内：`onOpenAutoFocus` 被 preventDefault，不补偿则焦点留在
    // 编辑器上，keydown 永不进入本组件（真实场景 ↑↓/↵ 全哑）。
    const tree = within(screen.getByRole('dialog')).getByTestId('peek-tree');
    await vi.waitFor(() => expect(tree).toHaveFocus());

    // 从**真实焦点元素**派发，而非直接打在 dialog 上——后者会绕过被测前提（假绿）。
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(useReferencesPeekStore.getState().selectedIndex).toBe(0);
    fireEvent.keyDown(tree, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///proj/a.go' }));
    });
  });

  it('should_close_with_escape', () => {
    seed();
    render(<ReferencesPeekDialog />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useReferencesPeekStore.getState().open).toBe(false);
  });

  it('should_expose_full_paths_via_title_for_truncated_names', () => {
    seed();
    render(<ReferencesPeekDialog />);
    expect(screen.getByTitle('/proj/a.go')).toBeInTheDocument();
  });

  it('should_resize_tree_pane_by_dragging_divider', () => {
    seed();
    render(<ReferencesPeekDialog />);
    const tree = screen.getByTestId('peek-tree');
    expect(tree).toHaveStyle({ width: '340px' });
    fireEvent.mouseDown(screen.getByRole('slider'), { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 380 });
    fireEvent.mouseUp(window);
    expect(tree).toHaveStyle({ width: '420px' });
  });

  it('should_resize_tree_pane_with_keyboard', () => {
    seed();
    render(<ReferencesPeekDialog />);
    const tree = screen.getByTestId('peek-tree');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(tree).toHaveStyle({ width: '350px' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    expect(tree).toHaveStyle({ width: '330px' });
  });

  it('should_unbind_window_drag_listeners_when_unmounted_mid_drag', () => {
    seed();
    const { unmount } = render(<ReferencesPeekDialog />);
    fireEvent.mouseDown(screen.getByRole('slider'), { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 380 });
    expect(screen.getByTestId('peek-tree')).toHaveStyle({ width: '420px' });

    // 拖拽途中卸载（Esc / 点遮罩）→ mouseup 不再到达本组件，必须兜底解绑 window 监听
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('should_be_resizable', async () => {
    seed();
    render(<ReferencesPeekDialog />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toMatch(/resize/);
  });

  it('should_open_maximized_by_default', async () => {
    seed();
    render(<ReferencesPeekDialog />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toMatch(/94vw/);
    expect(dialog.className).toMatch(/80vh/);
  });

  it('should_render_empty_state_when_no_items', () => {
    useReferencesPeekStore.setState({
      open: true,
      title: 'References (0)',
      loading: false,
      truncated: false,
      projectId: 'p1',
      selectedIndex: 0,
      groups: [],
    });
    render(<ReferencesPeekDialog />);
    expect(screen.getByText('No references found')).toBeInTheDocument();
  });
});
