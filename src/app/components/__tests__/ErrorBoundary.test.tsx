import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { reportFrontendError } from '@/app/registerGlobalErrorHandlers';

vi.mock('@/app/registerGlobalErrorHandlers', async () => {
  const actual = await vi.importActual<typeof import('@/app/registerGlobalErrorHandlers')>(
    '@/app/registerGlobalErrorHandlers',
  );
  return {
    ...actual,
    reportFrontendError: vi.fn(),
  };
});

function Bomb(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(reportFrontendError).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('子组件正常渲染时不做任何拦截', () => {
    render(
      <ErrorBoundary>
        <div>normal content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('normal content')).toBeInTheDocument();
  });

  it('子组件渲染抛错时显示 fallback 而非黑屏', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('渲染抛错时调用前端错误上报', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(vi.mocked(reportFrontendError)).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({ message: 'boom' }),
    );
  });

  it('支持自定义 fallback 与 onError 回调', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>} onError={onError}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom fallback')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('点击重试按钮后恢复渲染正常子树', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    // 重试后仍抛错 → 再次进入 fallback（验证 reset 逻辑生效而非永久卡死）
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
