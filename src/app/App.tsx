import { lazy, Suspense, useEffect, useMemo } from 'react';

import DockBarButton from '@/app/components/DockBarButton';
import OpenIdeButton from '@/app/components/OpenIdeButton';
import ProjectWorkspace from '@/app/components/ProjectWorkspace';
import { SplashScreen } from '@/app/components/SplashScreen';
import { dockPanelRegistry } from '@/app/dock/registry';
import { useAppShell } from '@/app/hooks';
import { DebugPanel, DebugRunButton } from '@/features/debug';
import { QuickOpenPalette, startQuickOpenActivityTracking } from '@/features/quick-open';
import SettingsView from '@/features/settings/components/SettingsView';
import SkillContent from '@/features/skill/components/SkillContent';
import { StatusBar } from '@/features/status-bar';
import { SymbolNavPalette } from '@/features/symbol-nav';
import { TaskConsolePanel } from '@/features/task';
import TaskRunButton from '@/features/task/components/TaskRunButton';
import { AppLayout, DockRegistryProvider, TitleBar } from '@/layout';
import { cn } from '@/lib/utils';
import { useMenuPaste } from '@/shared/hooks/useMenuPaste';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';

import AppModals from './AppModals';
import AppProviders from './AppProviders';

/** Lazy LibraryPanelWrapper — same chunk-splitting as the dock registry. */
const LazyLibraryPanel = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({ default: m.LibraryPanelWrapper })),
);

function App() {
  useMenuPaste();

  const { initializing, appProvidersProps, appLayoutProps, appModalsProps } = useAppShell();

  const appView = useAppViewStore((s) => s.appView);
  const skillsActive = useDockStore((s) => s.zones.left?.activePanelId === 'skills');

  const rawBarItems = useDockStore((s) => s.barItems);
  const leftButtons = useMemo(
    () =>
      rawBarItems
        .filter((item) => item.side === 'left' && item.visible)
        .sort((a, b) => a.order - b.order)
        .map((item) => <DockBarButton key={item.panelId} panelId={item.panelId} side="left" />),
    [rawBarItems],
  );
  const rightButtons = useMemo(
    () =>
      rawBarItems
        .filter((item) => item.side === 'right' && item.visible)
        .sort((a, b) => a.order - b.order)
        .map((item) => <DockBarButton key={item.panelId} panelId={item.panelId} side="right" />),
    [rawBarItems],
  );

  const centerContent =
    appView === 'settings' ? (
      <div className="flex-1 flex flex-col overflow-hidden">
        <SettingsView />
      </div>
    ) : appView === 'library' ? (
      // Resource Library 中央全宽展示（评审决策）：替换编辑区，隐藏 ProjectWorkspace
      <div className="flex-1 flex flex-col overflow-hidden">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
              Loading Library…
            </div>
          }
        >
          <LazyLibraryPanel />
        </Suspense>
      </div>
    ) : (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className={cn(
            'flex flex-col flex-1 h-full min-h-0 overflow-hidden rounded-lg shadow-sm bg-bg-secondary',
            skillsActive && 'hidden',
          )}
        >
          <ProjectWorkspace />
        </div>
        <div
          className={cn(
            'flex flex-col flex-1 h-full min-h-0 overflow-hidden rounded-lg shadow-sm bg-bg-secondary',
            !skillsActive && 'hidden',
          )}
        >
          <SkillContent />
        </div>
      </div>
    );

  useEffect(() => startQuickOpenActivityTracking(), []);

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
        <DockRegistryProvider registry={dockPanelRegistry}>
          <div className="flex-1 flex flex-col min-h-0 bg-bg-primary">
            <div className="flex-1 min-h-0 flex flex-col">
              <AppLayout
                {...appLayoutProps}
                isSettingsOpen={appView === 'settings'}
                leftButtons={leftButtons}
                rightButtons={rightButtons}
              >
                {centerContent}
              </AppLayout>
            </div>
            <TaskConsolePanel />
            <DebugPanel />
          </div>
          <AppModals {...appModalsProps} />
          <QuickOpenPalette />
          <SymbolNavPalette />
        </DockRegistryProvider>
      </AppProviders>

      <StatusBar />
    </div>
  );
}

export default App;
