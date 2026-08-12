import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAppInfo } from '@/features/settings/hooks/useAppInfo';
import type { AppInfo } from '@/shared/types/app';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

const mockAppInfo: AppInfo = {
  name: 'Neeko',
  version: '1.0.6',
  identifier: 'com.neeko.desktop',
  description: 'Multi-project AI agent session manager',
  authors: 'Tomgs',
  license: 'Apache-2.0',
  tauriVersion: '2.10.3',
  os: 'macos',
  arch: 'aarch64',
  copyright: 'Copyright © 2024 Tomgs. All rights reserved.',
};

describe('useAppInfo', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('初始状态为 loading', () => {
    mockInvoke.mockResolvedValue(mockAppInfo);
    const { result } = renderHook(() => useAppInfo());

    expect(result.current.state.status).toBe('loading');
  });

  it('挂载成功后进入 ready 并携带信息', async () => {
    mockInvoke.mockResolvedValue(mockAppInfo);
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
    });
    if (result.current.state.status !== 'ready') return;
    expect(result.current.state.info.name).toBe('Neeko');
    expect(result.current.state.info.version).toBe('1.0.6');
    expect(mockInvoke).toHaveBeenCalledWith('get_app_info');
  });

  it('拉取失败进入 error 状态', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });
  });

  it('retry 后重新拉取并转 ready', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(mockAppInfo);
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
    });
    if (result.current.state.status !== 'ready') return;
    expect(result.current.state.info.name).toBe('Neeko');
  });
});
