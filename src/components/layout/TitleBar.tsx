import React from "react";
import WindowControls from "./WindowControls";
import type {
   Project,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
} from "../../types";
import { IS_WINDOWS, IS_MACOS } from "../../utils/platform";
import linuxIcon from "../../assets/linux.svg";
import serverIcon from "../../assets/server.svg";
import { SettingsIcon, PlusIcon } from "../icons";

interface TitleBarProps {
   activeProject: Project | null;
   activeWslProject: { distro: string; project: WSLProject } | null;
   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeWorktreeBranch: string;
   activeWslWorktreeBranch: string;
   activeRemoteWorktreeBranch: string;
   showAddMenu: boolean;
   loading: boolean;
   onOpenSettings: () => void;
   onToggleAddMenu: () => void;
   onAddProject: () => void;
   onAddWsl: () => void;
   onAddRemote: () => void;
}

function TitleBar({
   activeProject,
   activeWslProject,
   activeRemoteProject,
   activeWorktreeBranch,
   activeWslWorktreeBranch,
   activeRemoteWorktreeBranch,
   showAddMenu,
   loading,
   onOpenSettings,
   onToggleAddMenu,
   onAddProject,
   onAddWsl,
   onAddRemote,
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
         className="titlebar flex items-center h-9 shrink-0 border-b border-border bg-bg-secondary select-none"
         data-tauri-drag-region
      >
         <div className="relative shrink-0 border-r border-border/70 px-2 py-1 flex items-center gap-1" data-tauri-drag-region>
            <span className="titlebar-appname text-xs font-semibold tracking-wide text-text-primary px-2" data-tauri-drag-region>
               NEEKO
            </span>
            <button className="tb-icon-btn w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary" onClick={onOpenSettings} title="Settings">
               <SettingsIcon size={14} />
            </button>
            <button className="tb-icon-btn w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" onClick={onToggleAddMenu} disabled={loading} title="Add">
               {loading ? "…" : <PlusIcon size={14} />}
            </button>

            {showAddMenu && (
               <div className="add-menu-dropdown absolute left-2 top-9 z-50 w-48 rounded-md border border-border bg-bg-tertiary shadow-lg overflow-hidden">
                  <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer" onClick={onAddProject}>
                     <span className="mr-2">📁</span>
                     <span>Add Local Project</span>
                  </div>
                  {IS_WINDOWS && (
                     <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center" onClick={onAddWsl}>
                        <img src={linuxIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                        <span>Add WSL Distro</span>
                     </div>
                  )}
                  <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center" onClick={onAddRemote}>
                     <img src={serverIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                     <span>Add Remote Server</span>
                  </div>
               </div>
            )}
         </div>

         <div className="flex-1 min-w-0 flex items-center px-2 gap-2" data-tauri-drag-region>
            <div className="flex-1" data-tauri-drag-region />
            <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
               {currentProjectName && <span className="text-xs font-medium text-text-primary max-w-[220px] truncate">{currentProjectName}</span>}
               {currentBranch && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-accent-green">{currentBranch}</span>}
               {!IS_MACOS && <WindowControls />}
            </div>
         </div>
      </div>
   );
}

export default React.memo(TitleBar);
