import React from "react";
import {
   AppProvider,
   SidebarProvider,
} from "@/shared/contexts";
import {
   ProjectActionsProvider,
} from "@/features/project/context";
import {
   FileActionsProvider,
} from "@/features/editor/FileActionsContext";
import {
   ConnectionProjectProvider,
} from "@/features/project/contexts/ConnectionProjectContext";
import {
   EditorProvider,
} from '@/shared/contexts';

type AppProviderValue = React.ComponentProps<typeof AppProvider>["value"];
type ProjectActionsProviderValue = React.ComponentProps<typeof ProjectActionsProvider>["value"];
type FileActionsProviderValue = React.ComponentProps<typeof FileActionsProvider>["value"];
type ConnectionProjectProviderValue = React.ComponentProps<typeof ConnectionProjectProvider>["value"];
type EditorProviderValue = React.ComponentProps<typeof EditorProvider>["value"];

interface AppProvidersProps {
   appValue: AppProviderValue;
   projectActionsValue: ProjectActionsProviderValue;
   fileActionsValue: FileActionsProviderValue;
   connectionProjectValue: ConnectionProjectProviderValue;
   editorValue: EditorProviderValue;
   children: React.ReactNode;
}

function AppProviders({
   appValue,
   projectActionsValue,
   fileActionsValue,
   connectionProjectValue,
   editorValue,
   children,
}: AppProvidersProps) {
   return (
      <AppProvider value={appValue}>
         <SidebarProvider>
            <ProjectActionsProvider value={projectActionsValue}>
               <FileActionsProvider value={fileActionsValue}>
                  <ConnectionProjectProvider value={connectionProjectValue}>
                     <EditorProvider value={editorValue}>{children}</EditorProvider>
                  </ConnectionProjectProvider>
               </FileActionsProvider>
            </ProjectActionsProvider>
         </SidebarProvider>
      </AppProvider>
   );
}

export default React.memo(AppProviders);
