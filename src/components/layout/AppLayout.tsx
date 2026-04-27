import React, { useEffect } from "react";
import { useSidebar, useFileActionsContext, SkillProvider } from "../../contexts";
import ActivityBar from "./ActivityBar";
import PanelArea from "./PanelArea";
import { ProjectsPanel, FilesPanel } from "../panels";
import { SkillsPanel, SkillContent } from "../skills";
import SettingsPanel from "../SettingsPanel";
import MainContent from "../MainContent";
import { useAppStore } from "../../store/appStore";
import type { AppConfig } from "../../types";

interface AppLayoutProps {
   onAddProject: () => void;
   onAddWsl: () => void;
   onAddRemote: () => void;
   onOpenSettings: () => void;
   settingsOpen: boolean;
   onCloseSettings: () => void;
   onConfigChange: (next: AppConfig) => void;
}

function AppLayout({ onAddProject, onAddWsl, onAddRemote, onOpenSettings, settingsOpen, onCloseSettings, onConfigChange }: AppLayoutProps) {
   const { activePanel } = useSidebar();
   const {
      onFileSelect,
      onFileRefresh,
      onLoadFileTree,
   } = useFileActionsContext();
   const activeProject = useAppStore((state) => state.activeProject);
   const activeProjectId = useAppStore((state) => state.activeProjectId);
   const fileTree = useAppStore((state) => state.fileTree);
   const fileViewLoading = useAppStore((state) => state.fileViewLoading);
   const activeFilePath = useAppStore((state) => state.activeFilePath);

   const activeProjectName = activeProject?.name ?? null;
   const skillsActive = activePanel === "skills";

   useEffect(() => {
      if (activePanel === "files" && activeProjectId) {
         onLoadFileTree(activeProjectId);
      }
   }, [activePanel, activeProjectId, onLoadFileTree]);

   return (
      <div className="flex flex-1 min-h-0 overflow-hidden bg-bg-primary">
         <ActivityBar
            onOpenSettings={onOpenSettings}
            onAddProject={onAddProject}
            onAddWsl={onAddWsl}
            onAddRemote={onAddRemote}
            isSettingsOpen={settingsOpen}
         />

         {settingsOpen ? (
            <div className="flex-1 flex min-w-0 transition-opacity duration-200 motion-safe:transition-opacity">
               <SettingsPanel
                  fullPage
                  onConfigChange={onConfigChange}
                  onClose={onCloseSettings}
               />
            </div>
         ) : skillsActive ? (
            <SkillProvider activeProjectId={activeProjectId}>
               <PanelArea>
                  <SkillsPanel />
               </PanelArea>
               <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
                  <SkillContent />
               </div>
            </SkillProvider>
         ) : (
            <>
               <PanelArea>
                  {activePanel === "projects" && <ProjectsPanel />}
                  {activePanel === "files" && (
                     <FilesPanel
                        projectName={activeProjectName}
                        fileTree={fileTree}
                        isLoading={fileViewLoading}
                        activeFilePath={activeFilePath}
                        onSelectFile={onFileSelect}
                        onRefresh={onFileRefresh}
                     />
                  )}
               </PanelArea>

               <MainContent />
            </>
         )}
      </div>
   );
}

export default React.memo(AppLayout);
