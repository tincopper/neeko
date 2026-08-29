import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/shared/store/notificationStore';

import App from '../App';

// 回归测试：StatusBar（及其通知子树）必须渲染在 AppProvider 内。
// Bug：App.tsx 中 <StatusBar /> 在 <AppProviders> 之外，NotificationDetail
// 经 useCopyToClipboard 调用 useAppContext() 时抛
// "useAppContext must be used within AppProvider"，导致应用崩溃。

// mock 组合层中的重型子组件，保持 StatusBar 为真实组件。
vi.mock('@/app/hooks', () => ({
  useAppShell: () => ({
    initializing: false,
    appProvidersProps: {
      appValue: {
        config: {} as never,
        customThemes: [],
        agents: [],
        agentInstalledMap: {},
        loading: false,
        ideCommandOverrides: {},
        showToast: vi.fn(),
        saveConfig: async () => {},
      },
      projectActionsValue: {} as never,
      fileActionsValue: {} as never,
      connectionProjectValue: {} as never,
      editorValue: {} as never,
    },
    toolbarProps: {
      onAddProject: vi.fn(),
      onAddWsl: vi.fn(),
      onAddRemote: vi.fn(),
      onOpenSettings: vi.fn(),
    },
    appModalsProps: {} as never,
  }),
  useDockBarButtons: () => [],
}));
vi.mock('@/layout', () => ({
  TitleBar: () => null,
  DockLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DockRegistryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/app/components/AppCenter', () => ({ default: () => <div /> }));
vi.mock('@/app/components/OpenIdeButton', () => ({ default: () => null }));
vi.mock('@/app/components/SplashScreen', () => ({ default: () => null }));
vi.mock('@/app/AppModals', () => ({ default: () => null }));
vi.mock('@/features/task', () => ({
  TaskConsolePanel: () => null,
  TaskRunButton: () => null,
}));
vi.mock('@/features/debug', () => ({
  DebugPanel: () => null,
  DebugRunButton: () => null,
}));
vi.mock('@/features/quick-open', () => ({ QuickOpenPalette: () => null }));
vi.mock('@/features/symbol-nav', () => ({ SymbolNavPalette: () => null }));
vi.mock('@/features/git', () => ({ BranchStatusBarWidget: () => null }));

describe('App 组合层', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  });

  it('通知详情弹窗在真实 App 组合层中可正常打开（StatusBar 需在 AppProvider 内）', () => {
    const notif = {
      id: 'n1',
      type: 'error',
      title: 'Deploy failed',
      message: 'Timeout after 30s',
      timestamp: Date.now(),
      read: false,
    };
    useNotificationStore.setState({ notifications: [notif], unreadCount: 1 });

    render(<App />);

    // 打开通知列表
    fireEvent.click(screen.getByTitle('Notifications'));
    // 点击某条通知查看详情
    fireEvent.click(screen.getByText('Deploy failed'));

    const detail = screen.getByRole('dialog');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent('Timeout after 30s');
  });
});
