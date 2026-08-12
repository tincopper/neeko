// eslint-disable-next-line no-restricted-imports -- 测试需直接断言 invoke 被调用（setup 已全局 mock）
import { invoke } from '@tauri-apps/api/core';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  reportFrontendError,
  resetFrontendErrorThrottle,
  setErrorNotifier,
} from '@/shared/utils/errorReporting';

const mockedInvoke = vi.mocked(invoke);
const mockNotify = vi.fn();

describe('reportFrontendError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    resetFrontendErrorThrottle();
    // 注入 mock notifier，避免依赖真实 notificationStore
    setErrorNotifier(mockNotify);
  });

  afterEach(() => {
    resetFrontendErrorThrottle();
    setErrorNotifier(null);
    vi.restoreAllMocks();
  });

  it('Error 对象上报 message 与 stack', () => {
    const err = new Error('boom');
    err.stack = 'at line 1';

    reportFrontendError('test.source', err);

    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_frontend_error',
      expect.objectContaining({ source: 'test.source', message: 'boom', stack: 'at line 1' }),
    );
    expect(mockNotify).toHaveBeenCalledWith('boom');
  });

  it('字符串错误原样作为 message', () => {
    reportFrontendError('test.source', 'raw message');

    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_frontend_error',
      expect.objectContaining({ message: 'raw message' }),
    );
  });

  it('非 Error 值转为字符串 message', () => {
    reportFrontendError('test.source', 42);

    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_frontend_error',
      expect.objectContaining({ message: '42' }),
    );
  });

  it('同 source 5s 内节流只上报一次', () => {
    reportFrontendError('test.source', 'a');
    reportFrontendError('test.source', 'b');

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('toast message 截断到 200 字符', () => {
    reportFrontendError('test.source', 'x'.repeat(500));

    expect(mockNotify).toHaveBeenCalledWith('x'.repeat(200));
  });

  it('未注册 notifier 时不抛错', () => {
    setErrorNotifier(null);

    expect(() => reportFrontendError('test.source', 'boom')).not.toThrow();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it('invoke 异步失败静默（不抛出）', () => {
    mockedInvoke.mockRejectedValue(new Error('network'));

    expect(() => reportFrontendError('test.source', 'boom')).not.toThrow();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('invoke 同步抛错也静默（async 防御包装回归）', () => {
    mockedInvoke.mockImplementation(() => {
      throw new Error('sync crash');
    });

    expect(() => reportFrontendError('test.source', 'boom')).not.toThrow();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('notifier 同步抛错也静默（不抛出）', () => {
    setErrorNotifier(() => {
      throw new Error('toast crash');
    });

    expect(() => reportFrontendError('test.source', 'boom')).not.toThrow();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});
