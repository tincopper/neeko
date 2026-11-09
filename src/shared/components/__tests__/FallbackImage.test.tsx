import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FallbackImage from '../FallbackImage';

describe('FallbackImage', () => {
  it('src 为 null 时渲染 fallback', () => {
    render(<FallbackImage src={null} fallback={<span>fallback</span>} />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('加载失败（onError）时切换到 fallback', () => {
    render(<FallbackImage src="a.png" alt="icon" fallback={<span>fallback</span>} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('src 变化后重置错误态，重新渲染 img', () => {
    const { rerender } = render(
      <FallbackImage src="a.png" alt="icon" fallback={<span>fallback</span>} />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('fallback')).toBeInTheDocument();

    rerender(<FallbackImage src="b.png" alt="icon" fallback={<span>fallback</span>} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'b.png');
  });

  it('回到已知失败的 src 时保持兜底（不重试同一 URL）', () => {
    const { rerender } = render(
      <FallbackImage src="a.png" alt="icon" fallback={<span>fallback</span>} />,
    );
    fireEvent.error(screen.getByRole('img'));

    rerender(<FallbackImage src="b.png" alt="icon" fallback={<span>fallback</span>} />);
    rerender(<FallbackImage src="a.png" alt="icon" fallback={<span>fallback</span>} />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('未传 className 时 inline style 尺寸 = size', () => {
    render(<FallbackImage src="a.png" alt="icon" size={24} />);
    expect(screen.getByRole('img')).toHaveStyle({ width: '24px', height: '24px' });
  });

  it('传了 className 时由调用方完全控制盒子，不注入 inline style', () => {
    render(<FallbackImage src="a.png" alt="icon" size={24} className="w-4 h-4" />);
    const img = screen.getByRole('img');
    expect(img).not.toHaveAttribute('style');
    expect(img).toHaveClass('w-4', 'h-4');
  });
});
