import { AppLayout, TitleBar } from "@/layout";
import { AppToast } from "@/shared/components/AppToast";
import { SplashScreen } from "@/app/components/SplashScreen";
import AppProviders from "./AppProviders";
import AppModals from "./AppModals";
import type { ActiveWslKey, ActiveRemoteKey } from "@/features/connection/components/types";
import { useAppShell } from "@/app/hooks";

export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  const {
    initializing,
    toast,
    titleBarProps,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  } = useAppShell();

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
        {...titleBarProps}
      />

      <AppProviders {...appProvidersProps}>
        <AppLayout {...appLayoutProps} />
        <AppModals {...appModalsProps} />
      </AppProviders>

      <AppToast toast={toast} />
    </div>
  );
}

export default App;
