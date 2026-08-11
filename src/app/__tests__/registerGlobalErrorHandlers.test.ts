import { describe, it, expect, vi, afterEach } from 'vitest';

import { registerGlobalErrorHandlers } from '@/app/registerGlobalErrorHandlers';

describe('registerGlobalErrorHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('注册后捕获 window error 事件并记录', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = registerGlobalErrorHandlers();

    const err = new Error('render boom');
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'render boom' }));

    expect(consoleSpy).toHaveBeenCalledWith('[Global] Uncaught error:', err);
    cleanup();
  });

  it('注册后捕获 unhandledrejection 事件并记录', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = registerGlobalErrorHandlers();

    const reason = new Error('async boom');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason }),
    );

    expect(consoleSpy).toHaveBeenCalledWith('[Global] Unhandled rejection:', reason);
    cleanup();
  });

  it('cleanup 后不再捕获事件', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = registerGlobalErrorHandlers();
    cleanup();

    // 用无 error 对象的普通 Event，避免 jsdom 对 error 事件的默认异常抛出
    window.dispatchEvent(new Event('error'));

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
