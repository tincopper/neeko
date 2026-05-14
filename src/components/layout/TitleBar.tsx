import React from "react";
import WindowControls from "./WindowControls";
import type {
   Project,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
} from "../../types";
import { IS_MACOS } from "../../utils/platform";
import neekoIcon from "../../assets/neeko-icon.png";

interface TitleBarProps {
   activeProject: Project | null;
   activeWslProject: { distro: string; project: WSLProject } | null;
   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeWorktreeBranch: string;
   activeWslWorktreeBranch: string;
   activeRemoteWorktreeBranch: string;
}

function TitleBar({
   activeProject,
   activeWslProject,
   activeRemoteProject,
   activeWorktreeBranch,
   activeWslWorktreeBranch,
   activeRemoteWorktreeBranch,
}: TitleBarProps) {
   const currentProjectName =
      activeProject?.name ??
      activeWslProject?.project.name ??
      activeRemoteProject?.project.name ??
      null;

   const currentBranch =
      activeProject?.git_info
         ? activeWorktreeBranch || activeProject.git_info.current_branch
         : activeWslProject?.project.git_info
            ? activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch
            : activeRemoteProject?.project.git_info
               ? activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch
               : null;

   return (
      <div
         className={`titlebar flex items-center h-9 shrink-0 select-none ${IS_MACOS ? 'pl-[72px]' : ''}`}
         data-tauri-drag-region
      >
         <div className="relative shrink-0 px-2 py-1 flex items-center gap-1" data-tauri-drag-region>
            <img src={neekoIcon} className="w-5 h-5 object-contain mx-1" alt="Neeko" data-tauri-drag-region />
         </div>

         <div className="flex-1 min-w-0 flex items-center px-2 gap-2" data-tauri-drag-region>
            <div className="flex-1" data-tauri-drag-region />
            <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
               {currentProjectName && <span className="text-[var(--font-size)] font-medium text-text-primary max-w-[220px] truncate">{currentProjectName}</span>}
               {currentBranch && <span className="text-[var(--font-size)] px-2 py-0.5 rounded-full bg-bg-tertiary text-accent-green">{currentBranch}</span>}
               {!IS_MACOS && <WindowControls />}
            </div>
         </div>
      </div>
   );
}

export default React.memo(TitleBar);
