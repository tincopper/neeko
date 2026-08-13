import { getCurrentWindow } from '@tauri-apps/api/window';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WindowControls from '../WindowControls';

describe('WindowControls', () => {
  const close = vi.fn();
  const destroy = vi.fn();
  const isMaximized = vi.fn(() => Promise.resolve(false));

  beforeEach(() => {
    vi.clearAllMocks();
    // 注入完整 mock 窗口实例（setup.ts 全局 mock 仅为默认返回）。
    vi.mocked(getCurrentWindow).mockReturnValue({
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      isMaximized,
      onResized: vi.fn(() => Promise.resolve(() => {})),
      close,
      destroy,
    } as never);
  });

  it('close button requests a close instead of destroying the window', async () => {
    render(<WindowControls />);

    // flush isMaximized 的异步 resolve（waitFor 内部走 act，避免未包裹的 state 更新）
    await waitFor(() => expect(isMaximized).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle('Close'));

    expect(close).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});
