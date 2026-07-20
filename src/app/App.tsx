import { useEffect } from "react";
import { AppLayout, TitleBar } from "@/layout";
import { StatusBar } from "@/features/status-bar";
import { DebugPanel } from "@/features/debug";
import {
  QuickOpenPalette,
  startQuickOpenActivityTracking,
} from "@/features/quick-open";
import { SplashScreen } from "@/app/components/SplashScreen";
import AppProviders from "./AppProviders";
import AppModals from "./AppModals";
import { useAppShell } from "@/app/hooks";

function App() {
  const {
    initializing,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  } = useAppShell();

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
      <TitleBar />

      <AppProviders {...appProvidersProps}>
        <div className="flex-1 flex flex-col min-h-0 bg-bg-primary">
          <div className="flex-1 min-h-0 flex flex-col">
            <AppLayout {...appLayoutProps} />
          </div>
          <DebugPanel />
        </div>
        <AppModals {...appModalsProps} />
        <QuickOpenPalette />
      </AppProviders>

      <StatusBar />
    </div>
  );
}

export default App;
