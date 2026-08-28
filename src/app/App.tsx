import { SplashScreen } from '@/app/components/SplashScreen';
import { dockPanelRegistry } from '@/app/dock/registry';
import { useAppShell, useDockBarButtons } from '@/app/hooks';
import { QuickOpenPalette } from '@/features/quick-open';
import { StatusBar } from '@/features/status-bar';
import { SymbolNavPalette } from '@/features/symbol-nav';
import { AppLayout, DockRegistryProvider, TitleBar } from '@/layout';
import { TerminalInsertProvider } from '@/shared/contexts';
import { useAppViewStore } from '@/shared/store/appViewStore';

import AppModals from './AppModals';
import AppProviders from './AppProviders';
import AppCenter from './components/AppCenter';
import FixedPanelsHost from './panels/FixedPanelsHost';
import TitleBarActions from './panels/TitleBarActions';

/**
 * 组合根：hooks + JSX 编排（AGENTS.md「组合层」）。
 * 应用级副作用（paste 监听、quick-open 跟踪）在 useAppShell 内；
 * 中心视图路由在 AppCenter（单一数据源 appViewStore）；
 * dock 栏按钮装配在 useDockBarButtons；固定面板/TitleBar 入口收敛在
 * src/app/panels/（registry 单一事实源，本文件对面板清单零感知）。本文件只做组装。
 */
function App() {
  const { initializing, appProvidersProps, appLayoutProps, appModalsProps } = useAppShell();

  const appView = useAppViewStore((s) => s.appView);
  const leftButtons = useDockBarButtons('left');
  const rightButtons = useDockBarButtons('right');

  if (initializing) {
    return <SplashScreen />;
  }

  return (
    <div
      className="w-screen h-screen flex flex-col"
      style={{
        background: `linear-gradient(to bottom, var(--bg-gradient-start), var(--bg-gradient-end))`,
      }}
    >
      <TitleBar actions={<TitleBarActions />} />

      <AppProviders {...appProvidersProps}>
        <TerminalInsertProvider>
          <DockRegistryProvider registry={dockPanelRegistry}>
            <div className="flex-1 flex flex-col min-h-0 bg-bg-primary">
              <div className="flex-1 min-h-0 flex flex-col">
                <AppLayout
                  {...appLayoutProps}
                  isSettingsOpen={appView === 'settings'}
                  leftButtons={leftButtons}
                  rightButtons={rightButtons}
                >
                  <AppCenter />
                </AppLayout>
              </div>
              <FixedPanelsHost />
            </div>
            <AppModals {...appModalsProps} />
            <QuickOpenPalette />
            <SymbolNavPalette />
          </DockRegistryProvider>
        </TerminalInsertProvider>
        {/* StatusBar 必须渲染在 AppProvider 内：NotificationDetail 经
            useCopyToClipboard 调用 useAppContext()，在 Provider 外会抛错导致崩溃。 */}
        <StatusBar />
      </AppProviders>
    </div>
  );
}

export default App;
