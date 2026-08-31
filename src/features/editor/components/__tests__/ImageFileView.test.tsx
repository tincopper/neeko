import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImageFileView from '@/features/editor/components/ImageFileView';

// 与真实 convertFileSrc 一致：path 保持原样，不额外加斜杠
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p.replace(/^\//, '')}`),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageFileView', () => {
  it('用 convertFileSrc 的 asset URL 渲染 <img>', () => {
    render(<ImageFileView absPath="/tmp/project/a.png" fileName="a.png" />);
    const img = screen.getByAltText('a.png');
    expect(img).toHaveAttribute('src', 'asset://localhost/tmp/project/a.png');
  });

  it('点击图片打开全屏遮罩，点击遮罩关闭', () => {
    render(<ImageFileView absPath="/tmp/project/a.png" fileName="a.png" />);
    expect(screen.queryByRole('button', { name: /close image preview/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByAltText('a.png'));
    expect(screen.getByRole('button', { name: /close image preview/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close image preview/i }));
    expect(screen.queryByRole('button', { name: /close image preview/i })).not.toBeInTheDocument();
  });

  it('加载失败时显示占位提示而非破图', () => {
    render(<ImageFileView absPath="/nonexistent/a.png" fileName="a.png" />);
    fireEvent.error(screen.getByAltText('a.png'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
