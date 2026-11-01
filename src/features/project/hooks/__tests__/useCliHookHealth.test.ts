import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';
import type { HookInstallStatus } from '@/shared/types/notification';

const { getCliHookStatus, getNotificationSettings, applyCliHooks, loadConfig } = vi.hoisted(() => ({
  getCliHookStatus: vi.fn(),
  getNotificationSettings: vi.fn(),
  applyCliHooks: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('@/features/notification/api/notificationApi', () => ({
  getCliHookStatus,
  getNotificationSettings,
  applyCliHooks,
}));
vi.mock('@/features/settings/api/settingsApi', () => ({ loadConfig, saveConfig: vi.fn() }));

import { useCliHookHealth } from '../useCliHookHealth';

function row(overrides: Partial<HookInstallStatus> & { source: string }): HookInstallStatus {
  return {
    path: `/home/u/.${overrides.source}`,
    installed: true,
    versionCurrent: true,
    selfSupplied: false,
    trusted: null,
    ...overrides,
  };
}

describe('useCliHookHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppViewStore.setState({ appView: 'normal' });
    loadConfig.mockResolvedValue({});
    getNotificationSettings.mockResolvedValue({ cliHooks: true });
  });

  it('全部生效 ⇒ 不提示', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi' })]);
    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(getCliHookStatus).toHaveBeenCalled());
    expect(result.current.attentionSources).toEqual([]);
  });

  it('hook 未安装 ⇒ 报出该 CLI（侧栏据此提示）', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(result.current.attentionSources).toEqual(['pi']));
  });

  it('主开关关闭 ⇒ 不提示（用户的显式选择优先）', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    getNotificationSettings.mockResolvedValue({ cliHooks: false });
    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(getCliHookStatus).toHaveBeenCalled());
    expect(result.current.attentionSources).toEqual([]);
  });

  it('重新安装：只覆盖「本机检测到且用户没关掉」的 CLI，随后刷新', async () => {
    getCliHookStatus.mockResolvedValue([
      row({ source: 'pi', installed: false }),
      row({ source: 'claude', installed: false }),
      row({ source: 'codex', path: '', installed: false }),
      row({ source: 'dsh', selfSupplied: true }),
    ]);
    loadConfig.mockResolvedValue({ agentHookSources: { claude: false } });
    applyCliHooks.mockResolvedValue([{ source: 'pi', status: 'applied', detail: null }]);

    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(result.current.attentionSources.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.reinstall();
    });

    expect(applyCliHooks).toHaveBeenCalledWith(true, ['pi']);
    // 刷新过：第二次读取状态
    expect(getCliHookStatus).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('安装回执里有 failed ⇒ 把失败原因暴露给 UI', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    applyCliHooks.mockResolvedValue([{ source: 'pi', status: 'failed', detail: 'denied' }]);

    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(result.current.attentionSources).toEqual(['pi']));
    await act(async () => {
      await result.current.reinstall();
    });

    await waitFor(() => expect(result.current.error).toBe('pi: denied'));
  });

  it('外部修复后重新探测成功 ⇒ 清除上一次安装错误，旧横幅不再滞留', async () => {
    getCliHookStatus
      .mockResolvedValueOnce([row({ source: 'pi', installed: false })])
      .mockResolvedValueOnce([row({ source: 'pi', installed: false })])
      .mockResolvedValue([row({ source: 'pi' })]);
    applyCliHooks.mockResolvedValueOnce([{ source: 'pi', status: 'failed', detail: 'denied' }]);

    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(result.current.attentionSources).toEqual(['pi']));

    await act(async () => {
      await result.current.reinstall();
    });
    expect(result.current.error).toBe('pi: denied');

    act(() => useAppViewStore.getState().setAppView('settings'));
    act(() => useAppViewStore.getState().setAppView('normal'));

    await waitFor(() => expect(result.current.attentionSources).toEqual([]));
    expect(result.current.error).toBeNull();
  });

  it('探测失败（读不到状态）⇒ 静默降级为不提示', async () => {
    getCliHookStatus.mockRejectedValue(new Error('ipc down'));
    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(getCliHookStatus).toHaveBeenCalled());
    expect(result.current.attentionSources).toEqual([]);
  });

  it('从设置页返回侧栏时重新探测，避免旧提示滞留', async () => {
    getCliHookStatus
      .mockResolvedValueOnce([row({ source: 'pi', installed: false })])
      .mockResolvedValue([row({ source: 'pi' })]);

    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(result.current.attentionSources).toEqual(['pi']));

    act(() => useAppViewStore.getState().setAppView('settings'));
    act(() => useAppViewStore.getState().setAppView('normal'));

    await waitFor(() => expect(result.current.attentionSources).toEqual([]));
    expect(getCliHookStatus).toHaveBeenCalledTimes(2);
  });

  it('读配置失败 ⇒ 不提示，且禁止用空覆盖表重装（否则会重装用户已关掉的 CLI）', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    loadConfig.mockRejectedValue(new Error('config read failed'));

    const { result } = renderHook(() => useCliHookHealth());
    await waitFor(() => expect(loadConfig).toHaveBeenCalled());
    expect(result.current.attentionSources).toEqual([]);

    await act(async () => {
      await result.current.reinstall();
    });
    expect(applyCliHooks).not.toHaveBeenCalled();
  });
});
