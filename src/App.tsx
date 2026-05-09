import { AppLayout, TitleBar } from "./components/layout";
import { AppToast } from "./components/AppToast";
import { SplashScreen } from "./components/SplashScreen";
import AppProviders from "./AppProviders";
import AppModals from "./AppModals";
import type { ActiveWslKey } from "./components/connections";
import { type ActiveRemoteKey, useAppContainer } from "./hooks";

export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  const {
    initializing,
    toast,
    titleBarProps,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  } = useAppContainer();

  if (initializing) {
    return <SplashScreen />;
  }

  return (
    <div className="w-screen h-screen flex flex-col">
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
