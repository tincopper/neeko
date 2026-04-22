import React from "react";
import {
   AppProvider,
   SidebarProvider,
   ProjectActionsProvider,
   FileActionsProvider,
   WslProvider,
   RemoteProvider,
   EditorProvider,
} from "./contexts";

type AppProviderValue = React.ComponentProps<typeof AppProvider>["value"];
type ProjectActionsProviderValue = React.ComponentProps<typeof ProjectActionsProvider>["value"];
type FileActionsProviderValue = React.ComponentProps<typeof FileActionsProvider>["value"];
type WslProviderValue = React.ComponentProps<typeof WslProvider>["value"];
type RemoteProviderValue = React.ComponentProps<typeof RemoteProvider>["value"];
type EditorProviderValue = React.ComponentProps<typeof EditorProvider>["value"];

interface AppProvidersProps {
   appValue: AppProviderValue;
   initialSidebarWidth: number;
   onSidebarWidthPersist: (w: number) => void;
   projectActionsValue: ProjectActionsProviderValue;
   fileActionsValue: FileActionsProviderValue;
   wslValue: WslProviderValue;
   remoteValue: RemoteProviderValue;
   editorValue: EditorProviderValue;
   children: React.ReactNode;
}

function AppProviders({
   appValue,
   initialSidebarWidth,
   onSidebarWidthPersist,
   projectActionsValue,
   fileActionsValue,
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
            <ProjectActionsProvider value={projectActionsValue}>
               <FileActionsProvider value={fileActionsValue}>
                  <WslProvider value={wslValue}>
                     <RemoteProvider value={remoteValue}>
                        <EditorProvider value={editorValue}>{children}</EditorProvider>
                     </RemoteProvider>
                  </WslProvider>
               </FileActionsProvider>
            </ProjectActionsProvider>
         </SidebarProvider>
      </AppProvider>
   );
}

export default React.memo(AppProviders);
