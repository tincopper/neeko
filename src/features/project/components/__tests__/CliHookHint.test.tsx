import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import CliHookHint from '../CliHookHint';

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

describe('CliHookHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfig.mockResolvedValue({});
    getNotificationSettings.mockResolvedValue({ cliHooks: true });
    applyCliHooks.mockResolvedValue([]);
  });

  it('hook 全部生效时什么都不渲染（侧栏不留常驻横幅）', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi' })]);
    const { container } = render(<CliHookHint />);
    await waitFor(() => expect(getCliHookStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('未生效时说明后果（标题不跟随 CLI）+ 给出 CLI 名与重新安装按钮', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    render(<CliHookHint />);

    expect(await screen.findByTestId('cli-hook-hint')).toBeInTheDocument();
    expect(screen.getByText(/会话标题未跟随 CLI/)).toBeInTheDocument();
    expect(screen.getByText(/pi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新安装' })).toBeInTheDocument();
  });

  it('点「重新安装」触发 applyCliHooks；装好之后提示消失', async () => {
    getCliHookStatus
      .mockResolvedValueOnce([row({ source: 'pi', installed: false })])
      .mockResolvedValue([row({ source: 'pi' })]);
    render(<CliHookHint />);

    fireEvent.click(await screen.findByRole('button', { name: '重新安装' }));

    await waitFor(() => expect(applyCliHooks).toHaveBeenCalledWith(true, ['pi']));
    await waitFor(() => expect(screen.queryByTestId('cli-hook-hint')).not.toBeInTheDocument());
  });

  it('安装失败时把原因显示出来（不静默吞掉）', async () => {
    getCliHookStatus.mockResolvedValue([row({ source: 'pi', installed: false })]);
    applyCliHooks.mockResolvedValue([{ source: 'pi', status: 'failed', detail: 'denied' }]);
    render(<CliHookHint />);

    fireEvent.click(await screen.findByRole('button', { name: '重新安装' }));
    expect(await screen.findByText(/Hook 安装失败：pi: denied/)).toBeInTheDocument();
  });
});
