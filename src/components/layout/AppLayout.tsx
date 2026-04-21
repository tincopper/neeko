import React, { useEffect } from "react";
import { useSidebar } from "../../context/sidebar-context";
import {
  useProjectStateContext,
  useProjectActionsContext,
} from "../../contexts";
import { SkillProvider } from "../../context/skill-context";
import ActivityBar from "./ActivityBar";
import PanelArea from "./PanelArea";
import ProjectsPanel from "../panels/ProjectsPanel";
import FilesPanel from "../panels/FilesPanel";
import SkillsPanel from "../panels/SkillsPanel";
import SkillContent from "../skills/SkillContent";
import MainContent from "../MainContent";

interface AppLayoutProps {
   onAddProject: () => void;
   onAddWsl: () => void;
   onAddRemote: () => void;
   onOpenSettings: () => void;
}

function AppLayout({ onAddProject, onAddWsl, onAddRemote, onOpenSettings }: AppLayoutProps) {
   const { activePanel } = useSidebar();
   const {
      activeProject,
      activeProjectId,
      fileTree,
      fileViewLoading,
      activeFilePath,
   } = useProjectStateContext();
   const {
      onFileSelect,
      onFileRefresh,
      onLoadFileTree,
   } = useProjectActionsContext();

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
