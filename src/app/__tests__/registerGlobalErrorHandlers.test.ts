// eslint-disable-next-line no-restricted-imports -- 测试需直接断言 invoke 被调用（setup 已全局 mock）
import { invoke } from '@tauri-apps/api/core';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// invoke 由 testing/setup.ts 全局 mock（返回 undefined）；此处设置返回 Promise，
// 保证 errorReporting 内部 invoke(...).catch 链可用。

import {
  registerGlobalErrorHandlers,
  resetFrontendErrorThrottle,
} from '@/app/registerGlobalErrorHandlers';
import { useNotificationStore } from '@/shared/store/notificationStore';

const mockedInvoke = vi.mocked(invoke);
const mockAddNotification = vi.fn();

describe('registerGlobalErrorHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    // 重置模块级节流状态，避免跨用例污染
    resetFrontendErrorThrottle();
    // 替换 notification store 的 addNotification
    useNotificationStore.getState().addNotification = mockAddNotification;
  });

  afterEach(() => {
    resetFrontendErrorThrottle();
    vi.restoreAllMocks();
  });

  const fireError = (error: unknown, message: string) => {
    window.dispatchEvent(new ErrorEvent('error', { error, message }));
  };

  it('注册后捕获 window error 事件并记录', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = registerGlobalErrorHandlers();

    const err = new Error('render boom');
    fireError(err, 'render boom');

    expect(consoleSpy).toHaveBeenCalledWith('[Global] Uncaught error:', err);
    cleanup();
  });

  it('捕获 error 事件时上报 Rust 日志命令', () => {
    const cleanup = registerGlobalErrorHandlers();

    const err = new Error('render boom');
    fireError(err, 'render boom');

    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_frontend_error',
      expect.objectContaining({ source: 'window.error', message: 'render boom' }),
    );
    cleanup();
  });

  it('捕获 unhandledrejection 时上报 Rust 日志命令', () => {
    const cleanup = registerGlobalErrorHandlers();

    const reason = new Error('async boom');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason }),
    );

    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_frontend_error',
      expect.objectContaining({ source: 'unhandledrejection', message: 'async boom' }),
    );
    cleanup();
  });

  it('捕获错误时展示用户提示（toast）', () => {
    const cleanup = registerGlobalErrorHandlers();

    const err = new Error('visible boom');
    fireError(err, 'visible boom');

    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    cleanup();
  });

  it('同一 source 短时间内节流，只上报一次', () => {
    const cleanup = registerGlobalErrorHandlers();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('a'), message: 'a' }));
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('b'), message: 'b' }));

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('cleanup 后不再捕获事件', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = registerGlobalErrorHandlers();
    cleanup();

    window.dispatchEvent(new Event('error'));

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
