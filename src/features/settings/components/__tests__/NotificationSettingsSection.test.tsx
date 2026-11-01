/**
 * NotificationSettingsSection 关键行为：加载渲染、开关即存（串行链）、事件覆盖写入、
 * 保存失败回滚磁盘现值、以及主开关驱动 `CliHooksSection` 同步文件面。
 * api 门面整体 mock，不触真实 invoke。
 *
 * 逐 CLI 覆盖表的**纯函数**判定（`readSourceOverrides` / `enabledSourcesFor`）在
 * `CliHooksSection.test.tsx` 单独覆盖。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/notification/api/notificationApi', () => ({
  getNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
  sendTestNotification: vi.fn(),
  applyCliHooks: vi.fn(),
  getCliHookStatus: vi.fn(),
}));

// CliHooksSection（子组件）走通用 config 命令读逐 CLI 覆盖表，故一并 mock。
vi.mock('@/features/settings/api/settingsApi', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));
vi.mock('@/features/session/api/sessionApi', () => ({
  patchConfig: vi.fn(),
}));

import {
  applyCliHooks,
  getCliHookStatus,
  getNotificationSettings,
  saveNotificationSettings,
} from '@/features/notification/api/notificationApi';
import { loadConfig, saveConfig } from '@/features/settings/api/settingsApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/shared/types/notification';
import type { HookInstallStatus } from '@/shared/types/notification';

import NotificationSettingsSection from '../NotificationSettingsSection';

/** 最近一条 in-app 通知（store 头插）—— 组件对回执的分类唯一可观测出口。 */
function latestNotification() {
  return useNotificationStore.getState().notifications[0];
}

const HOOK_ROWS: HookInstallStatus[] = [
  {
    source: 'pi',
    path: '/x/neeko-status.ts',
    selfSupplied: false,
    installed: false,
    versionCurrent: false,
    trusted: null,
  },
];

function setupSettings() {
  vi.mocked(getNotificationSettings).mockResolvedValue({ ...DEFAULT_NOTIFICATION_SETTINGS });
  vi.mocked(saveNotificationSettings).mockResolvedValue(undefined);
  vi.mocked(applyCliHooks).mockResolvedValue([]);
  vi.mocked(getCliHookStatus).mockResolvedValue(HOOK_ROWS);
  vi.mocked(loadConfig).mockResolvedValue({});
  vi.mocked(saveConfig).mockResolvedValue(undefined);
}

async function renderLoaded() {
  render(<NotificationSettingsSection />);
  await screen.findByRole('switch', { name: 'Enable notifications' });
}

describe('NotificationSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    setupSettings();
  });

  /** 加载后渲染三层开关 + 失焦抑制 + CLI hooks = 6 个 switch，4 个事件行。
   *
   * 数量钉死是有意的：多一个开关意味着有人又往设置面塞了通道。Agent 通知只有系统通知
   * 一条通道（应用内镜像已按需求删除），改这个数字前先读 `dispatch.rs` 模块头。 */
  it('renders the switch surface after load', async () => {
    await renderLoaded();
    expect(screen.getAllByRole('switch')).toHaveLength(6);
    expect(screen.getByLabelText('Agent needs approval')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent turn completed')).toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Mirror into the in-app list' }),
    ).not.toBeInTheDocument();
  });

  /** 点击全局开关 → 串行链发出一次保存，载荷为打补丁后的完整设置。 */
  it('saves patched settings on toggle', async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    await waitFor(() => expect(saveNotificationSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveNotificationSettings).mock.calls[0][0]).toMatchObject({
      enabled: false,
      actionRequired: true,
    });
  });

  /** 取消勾选事件行 → 写入显式 false 覆盖（不触碰类别开关）。 */
  it('writes explicit event override on uncheck', async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Agent needs approval'));
    await waitFor(() => expect(saveNotificationSettings).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveNotificationSettings).mock.calls[0][0];
    expect(saved.eventOverrides['agent.approval_requested']).toBe(false);
    expect(saved.actionRequired).toBe(true);
  });

  /** 切换 CLI hooks 开关 → 设置持久化后串行联动 applyCliHooks（先意图后文件面）。 */
  it('chains applyCliHooks after persisting the toggle', async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Notify agents launched in my terminal' }));
    await waitFor(() => expect(saveNotificationSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(applyCliHooks).toHaveBeenCalledWith(true, ['pi']));
    // 非 hooks 变更不触发联动（当前只点过一次开关）。
    expect(applyCliHooks).toHaveBeenCalledTimes(1);
  });

  /** 回执按机器可读 status 分类：failed → error，且只呈现失败项。 */
  it('surfaces only failed hook outcomes as errors', async () => {
    await renderLoaded();
    vi.mocked(applyCliHooks).mockResolvedValueOnce([
      { source: 'opencode', status: 'failed', detail: 'mkdir denied' },
      { source: 'pi', status: 'applied', detail: '' },
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Notify agents launched in my terminal' }));
    await waitFor(() =>
      expect(latestNotification()).toMatchObject({
        type: 'error',
        message: 'CLI hooks: opencode: failed (mkdir denied)',
      }),
    );
  });

  /** skipped 是中性状态（同名他人文件保护）→ info，不得弹错误。 */
  it('reports skipped hook outcomes as neutral info', async () => {
    await renderLoaded();
    vi.mocked(applyCliHooks).mockResolvedValueOnce([
      { source: 'pi', status: 'skipped', detail: 'neeko-status.ts is not Neeko-managed, kept' },
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Notify agents launched in my terminal' }));
    await waitFor(() =>
      expect(latestNotification()).toMatchObject({
        type: 'info',
        message: 'CLI hooks: pi: skipped (neeko-status.ts is not Neeko-managed, kept)',
      }),
    );
  });

  /** 保存失败 → 回读磁盘现值回滚（单一事实源在磁盘）。 */
  it('rolls back to persisted value when save fails', async () => {
    await renderLoaded();
    const user = userEvent.setup();
    vi.mocked(saveNotificationSettings).mockRejectedValueOnce(new Error('disk'));
    const after = { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true };
    vi.mocked(getNotificationSettings).mockResolvedValueOnce(after);

    await user.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    // 失败回滚会再次 getNotificationSettings：初始加载 1 次 + 回滚 1 次
    await waitFor(() => expect(getNotificationSettings).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Enable notifications' })).toHaveAttribute(
        'data-state',
        'checked',
      ),
    );
  });
});
