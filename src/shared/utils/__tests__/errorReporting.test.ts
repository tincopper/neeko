// eslint-disable-next-line no-restricted-imports -- 测试需直接断言 invoke 被调用（setup 已全局 mock）
import { invoke } from '@tauri-apps/api/core';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  isBenignWarning,
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

describe('isBenignWarning', () => {
  it('识别 ResizeObserver loop 前缀为良性警告', () => {
    expect(isBenignWarning('ResizeObserver loop completed with undelivered notifications.')).toBe(
      true,
    );
  });

  it('普通错误非良性警告', () => {
    expect(isBenignWarning('render boom')).toBe(false);
  });

  it('识别 CodeMirror scanTile 内部崩溃为良性（外部库已知边界 bug，自愈）', () => {
    // posAtCoords → scanTile：hover 定时检查触发，tile.children[scan.i] 越界，
    // 该次 hover 检查自愈、无功能损害——落日志、不打扰用户
    expect(isBenignWarning("undefined is not an object (evaluating 'child.isText')")).toBe(true);
  });

  it('同族 posAtCoords 崩溃（d.top 形态）非良性（属于应上报的真实回归）', () => {
    expect(isBenignWarning("undefined is not an object (evaluating 'd.top')")).toBe(false);
  });
});

describe('reportFrontendError 良性警告豁免', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    resetFrontendErrorThrottle();
    setErrorNotifier(mockNotify);
  });

  afterEach(() => {
    resetFrontendErrorThrottle();
    setErrorNotifier(null);
    vi.restoreAllMocks();
  });

  it('良性警告仍落日志但不弹 toast', () => {
    reportFrontendError(
      'window.error',
      'ResizeObserver loop completed with undelivered notifications.',
    );

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
