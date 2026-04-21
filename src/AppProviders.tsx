import React from "react";
import { AppProvider } from "./context/app-context";
import { SidebarProvider } from "./context/sidebar-context";
import {
  ProjectStateProvider,
  ProjectActionsProvider,
  WslProvider,
  RemoteProvider,
  EditorProvider,
} from "./contexts";

type AppProviderValue = React.ComponentProps<typeof AppProvider>["value"];
type ProjectStateProviderValue = React.ComponentProps<typeof ProjectStateProvider>["value"];
type ProjectActionsProviderValue = React.ComponentProps<typeof ProjectActionsProvider>["value"];
type WslProviderValue = React.ComponentProps<typeof WslProvider>["value"];
type RemoteProviderValue = React.ComponentProps<typeof RemoteProvider>["value"];
type EditorProviderValue = React.ComponentProps<typeof EditorProvider>["value"];

interface AppProvidersProps {
  appValue: AppProviderValue;
  initialSidebarWidth: number;
  onSidebarWidthPersist: (w: number) => void;
  projectStateValue: ProjectStateProviderValue;
  projectActionsValue: ProjectActionsProviderValue;
  wslValue: WslProviderValue;
  remoteValue: RemoteProviderValue;
  editorValue: EditorProviderValue;
  children: React.ReactNode;
}

function AppProviders({
  appValue,
  initialSidebarWidth,
  onSidebarWidthPersist,
  projectStateValue,
  projectActionsValue,
  wslValue,
  remoteValue,
  editorValue,
  children,
}: AppProvidersProps) {
  return (
    <AppProvider value={appValue}>
      <SidebarProvider
        initialPanelWidth={initialSidebarWidth}
        onPanelWidthPersist={onSidebarWidthPersist}
      >
        <ProjectStateProvider value={projectStateValue}>
          <ProjectActionsProvider value={projectActionsValue}>
            <WslProvider value={wslValue}>
              <RemoteProvider value={remoteValue}>
                <EditorProvider value={editorValue}>{children}</EditorProvider>
              </RemoteProvider>
            </WslProvider>
          </ProjectActionsProvider>
        </ProjectStateProvider>
      </SidebarProvider>
    </AppProvider>
  );
}

export default React.memo(AppProviders);
