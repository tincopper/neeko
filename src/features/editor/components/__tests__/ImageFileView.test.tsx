import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImageFileView from '@/features/editor/components/ImageFileView';

// setup.ts 全局 mock：convertFileSrc → `asset://localhost/${path}`（path 原样）

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageFileView', () => {
  it('Workspace 相对路径按 basePath 解析成 asset URL', () => {
    render(<ImageFileView filePath="img/a.png" basePath="/tmp/project" fileName="a.png" />);
    expect(screen.getByAltText('a.png')).toHaveAttribute(
      'src',
      'asset://localhost//tmp/project/img/a.png',
    );
  });

  it('worktree 根作为基准（不是主仓根）：同一相对路径解析到工作树内', () => {
    // 回归锁定：历史实现接「由 project.path 派生的绝对路径」⇒ worktree 下指向主仓。
    render(
      <ImageFileView filePath="img/a.png" basePath="/repo/.worktrees/feat-x" fileName="a.png" />,
    );
    expect(screen.getByAltText('a.png')).toHaveAttribute(
      'src',
      'asset://localhost//repo/.worktrees/feat-x/img/a.png',
    );
  });

  it('点击图片打开全屏遮罩，点击遮罩关闭', () => {
    render(<ImageFileView filePath="a.png" basePath="/tmp/project" fileName="a.png" />);
    expect(screen.queryByRole('button', { name: /close image preview/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByAltText('a.png'));
    expect(screen.getByRole('button', { name: /close image preview/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close image preview/i }));
    expect(screen.queryByRole('button', { name: /close image preview/i })).not.toBeInTheDocument();
  });

  it('滚动容器的补偿只落 inline 调整，类名保留 Tailwind 基线 p-4', () => {
    render(<ImageFileView filePath="a.png" basePath="/tmp/project" fileName="a.png" />);
    // eslint-disable-next-line testing-library/no-node-access -- 结构断言：滚动容器是 img 的直接父节点
    const scroller = screen.getByAltText('a.png').parentElement;
    expect(scroller).toHaveClass('p-4', 'overflow-auto');
    expect(scroller?.className).not.toContain('calc(');
  });

  it('加载失败时显示占位提示而非破图', () => {
    render(<ImageFileView filePath="a.png" basePath="/nonexistent" fileName="a.png" />);
    fireEvent.error(screen.getByAltText('a.png'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
