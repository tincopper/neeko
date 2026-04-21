import React, { useEffect } from "react";
import { useSidebar } from "../../context/sidebar-context";
import { useFileActionsContext } from "../../contexts";
import { SkillProvider } from "../../context/skill-context";
import ActivityBar from "./ActivityBar";
import PanelArea from "./PanelArea";
import { ProjectsPanel, FilesPanel } from "../panels";
import { SkillsPanel, SkillContent } from "../skills";
import MainContent from "../MainContent";
import { useAppStore } from "../../store/appStore";

interface AppLayoutProps {
   onAddProject: () => void;
   onAddWsl: () => void;
   onAddRemote: () => void;
   onOpenSettings: () => void;
}

function AppLayout({ onAddProject, onAddWsl, onAddRemote, onOpenSettings }: AppLayoutProps) {
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
         />

         {skillsActive ? (
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
