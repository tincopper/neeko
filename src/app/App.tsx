import OpenIdeButton from '@/app/components/OpenIdeButton';
import { SplashScreen } from '@/app/components/SplashScreen';
import { dockPanelRegistry } from '@/app/dock/registry';
import { useAppShell, useDockBarButtons } from '@/app/hooks';
import { DebugPanel, DebugRunButton } from '@/features/debug';
import { QuickOpenPalette } from '@/features/quick-open';
import { StatusBar } from '@/features/status-bar';
import { SymbolNavPalette } from '@/features/symbol-nav';
import { TaskConsolePanel, TaskRunButton } from '@/features/task';
import { AppLayout, DockRegistryProvider, TitleBar } from '@/layout';
import { TerminalInsertProvider } from '@/shared/contexts';
import { useAppViewStore } from '@/shared/store/appViewStore';

import AppModals from './AppModals';
import AppProviders from './AppProviders';
import AppCenter from './components/AppCenter';

/**
 * 组合根：hooks + JSX 编排（AGENTS.md「组合层」）。
 * 应用级副作用（paste 监听、quick-open 跟踪）在 useAppShell 内；
 * 中心视图路由在 AppCenter（单一数据源 appViewStore）；
 * dock 栏按钮装配在 useDockBarButtons。本文件只做组装。
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
      <TitleBar
        actions={
          <>
            <OpenIdeButton />
            <TaskRunButton />
            <DebugRunButton />
          </>
        }
      />

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
              <TaskConsolePanel />
              <DebugPanel />
            </div>
            <AppModals {...appModalsProps} />
            <QuickOpenPalette />
            <SymbolNavPalette />
          </DockRegistryProvider>
        </TerminalInsertProvider>
      </AppProviders>

      <StatusBar />
    </div>
  );
}

export default App;
