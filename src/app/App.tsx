import { AppLayout, TitleBar, StatusBar } from "@/layout";
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
        <AppLayout {...appLayoutProps} />
        <AppModals {...appModalsProps} />
      </AppProviders>

      <StatusBar />
    </div>
  );
}

export default App;
