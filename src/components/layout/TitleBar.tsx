import React from "react";
import { GitBranch } from "lucide-react";
import WindowControls from "./WindowControls";
import TaskRunButton from "./TaskRunButton";
import type {
   Project,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
} from "../../types";
import { IS_MACOS } from "../../utils/platform";
import { useAppStore } from "../../store/appStore";
import { getAvatarStyle, getProjectInitials } from "../../utils/projectAvatar";
import neekoIcon from "../../assets/neeko-icon.png";

/** DockBar fixed width in pixels (w-11 = 44px) */
const DOCK_BAR_WIDTH = 44;

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
   const leftPanelWidth = useAppStore((s) => s.leftPanelWidth);

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

   // DockBar(44px) + left panel width + island padding (pr-0.5 = 2px)
   const leftSectionWidth = DOCK_BAR_WIDTH + leftPanelWidth + 2;

   return (
      <div
         className="titlebar flex items-center h-9 shrink-0 select-none"
         data-tauri-drag-region
      >
         {/* Left section: fixed width when panel is open (aligns with Projects Panel
             right edge), or auto width when panel is collapsed / not yet measured */}
         <div
            className="shrink-0 flex items-center px-2"
            style={leftPanelWidth > 0 ? { width: `${leftSectionWidth}px` } : undefined}
            data-tauri-drag-region
         >
            <img src={neekoIcon} className="w-5 h-5 object-contain mx-1 shrink-0" alt="Neeko" data-tauri-drag-region />
            {/* Spacer only when panel is open — pushes project name to right edge */}
            {leftPanelWidth > 0 && <div className="flex-1" data-tauri-drag-region />}
            {/* Project name + branch — always visible */}
            <div className="flex items-center gap-3 shrink-0 ml-2" data-tauri-drag-region>
               {currentProjectName && (
                  <span className="flex items-center gap-1.5 shrink-0" data-tauri-drag-region>
                     <span
                        className="w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase"
                        style={getAvatarStyle(currentProjectName)}
                     >
                        {getProjectInitials(currentProjectName)}
                     </span>
                     <span className="text-[var(--font-size)] font-medium text-text-primary max-w-[160px] truncate">
                        {currentProjectName}
                     </span>
                  </span>
               )}
               {currentBranch && (
                  <span className="flex items-center gap-1 text-[var(--font-size)] text-accent-green shrink-0" data-tauri-drag-region>
                     <GitBranch size={12} className="shrink-0" />
                     <span className="max-w-[120px] truncate">{currentBranch}</span>
                  </span>
               )}
            </div>
         </div>

         {/* Center spacer (draggable) */}
         <div className="flex-1" data-tauri-drag-region />

         {/* Right: TaskRunButton + WindowControls */}
         <div className="flex items-center gap-2 shrink-0 px-2">
            <TaskRunButton />
            {!IS_MACOS && <WindowControls />}
         </div>
      </div>
   );
}

export default React.memo(TitleBar);
