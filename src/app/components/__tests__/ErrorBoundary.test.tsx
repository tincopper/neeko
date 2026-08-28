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
    vi.useRealTimers();
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

  it('首次崩溃不渲染错误页：上报通知后自动重试，恢复后界面如常', () => {
    // React 对 boundary 捕获会打印错误日志，静音避免测试输出噪音
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('flaky');
      return <div>recovered content</div>;
    }
    render(
      <ErrorBoundary
        onError={() => {
          shouldThrow = false;
        }}
      >
        <Flaky />
      </ErrorBoundary>,
    );
    // 无全屏错误页 / 占位，children 自动重试后恢复正常渲染
    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.mocked(reportFrontendError)).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({ message: 'flaky' }),
    );
  });

  it('确定性崩溃：窗口内二次崩溃后渲染轻量降级占位', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('界面渲染出现异常，已停止自动重试')).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it('渲染抛错时调用前端错误上报', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('支持自定义 fallback 与 onError 回调（崩溃即 fallback，不自动重试）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('点击重试按钮后再次崩溃仍会进入占位（不无限循环）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    // reset → children 再崩 → 一轮自动重试 → 仍崩 → 再次进占位（验证收敛而非死循环）
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('超过重试窗口后再次崩溃：作为新一波故障重新获得自动重试机会', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('flaky');
      return <div>ok content</div>;
    }
    const boundary = (
      <ErrorBoundary
        onError={() => {
          shouldThrow = false;
        }}
      >
        <Flaky />
      </ErrorBoundary>
    );
    const { rerender } = render(boundary);
    expect(screen.getByText('ok content')).toBeInTheDocument();

    // 15s 后（窗口过期）又崩 → 视为新一波，自动重试再次生效
    vi.advanceTimersByTime(15_000);
    shouldThrow = true;
    rerender(boundary);
    expect(screen.getByText('ok content')).toBeInTheDocument();
  });
});
