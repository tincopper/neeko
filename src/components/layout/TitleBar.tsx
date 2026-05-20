import React, { useState, useCallback } from "react";
import WindowControls from "./WindowControls";
import TaskRunButton from "./TaskRunButton";
import OpenIdeButton from "./OpenIdeButton";
import TitleBarBranchSwitcher from "./TitleBarBranchSwitcher";
import GitDialog from "../project/GitDialog";
import type { DialogState } from "../project/GitDialog";
import type {
   Project,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
} from "../../types";
import { IS_MACOS } from "../../utils/platform";
import { useAppStore } from "../../store/appStore";
import { getAvatarStyle } from "../../utils/projectAvatar";
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
   branches: string[];
   isBranchSwitching: boolean;
   onCheckoutBranch: (branchName: string) => void;
   onRefreshGit: () => void;
}

function TitleBar({
   activeProject,
   activeWslProject,
   activeRemoteProject,
   activeWorktreeBranch,
   activeWslWorktreeBranch,
   activeRemoteWorktreeBranch,
   branches,
   isBranchSwitching,
   onCheckoutBranch,
   onRefreshGit,
}: TitleBarProps) {
   const leftPanelWidth = useAppStore((s) => s.leftPanelWidth);

   // ── Dialog state: owned by TitleBar, not by App ───────────────────────
   const [dialogState, setDialogState] = useState<DialogState | null>(null);

   const handleNewBranch = useCallback(() => {
      if (activeProject) {
         setDialogState({
            type: "new-branch",
            projectId: activeProject.id,
            branches: activeProject.git_info?.branches ?? [],
            projectPath: activeProject.path,
         });
      } else if (activeWslProject) {
         setDialogState({
            type: "new-branch",
            branches: activeWslProject.project.git_info?.branches ?? [],
            projectPath: activeWslProject.project.path,
            source: {
               type: "wsl",
               distro: activeWslProject.distro,
               projectPath: activeWslProject.project.path,
            },
         });
      } else if (activeRemoteProject) {
         setDialogState({
            type: "new-branch",
            branches: activeRemoteProject.project.git_info?.branches ?? [],
            projectPath: activeRemoteProject.project.path,
            source: {
               type: "remote",
               entryId: activeRemoteProject.entry.id,
               projectPath: activeRemoteProject.project.path,
            },
         });
      }
   }, [activeProject, activeWslProject, activeRemoteProject]);

   const handleDialogClose = useCallback(() => setDialogState(null), []);

   const handleDialogRefreshGit = useCallback((_projectId: string) => {
      onRefreshGit();
   }, [onRefreshGit]);

   // ── Derived display values ────────────────────────────────────────────
   const currentProjectName =
      activeProject?.name ??
      activeWslProject?.project.name ??
      activeRemoteProject?.project.name ??
      null;

   const currentAvatarColor =
      activeProject?.avatar_color ??
      activeWslProject?.project.avatar_color ??
      activeRemoteProject?.project.avatar_color ??
      null;

   const currentBranch =
      activeProject?.git_info
         ? activeWorktreeBranch || activeProject.git_info.current_branch
         : activeWslProject?.project.git_info
            ? activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch
            : activeRemoteProject?.project.git_info
               ? activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch
               : null;

   // Worktree mode: a dedicated worktree branch is active — branch switching is disabled
   const isWorktreeMode = !!(activeWorktreeBranch || activeWslWorktreeBranch || activeRemoteWorktreeBranch);

   // DockBar(44px) + left panel width + island padding (pr-0.5 = 2px)
   const leftSectionWidth = DOCK_BAR_WIDTH + leftPanelWidth + 2;

   return (
      <>
         <div
             className={`titlebar flex items-center h-9 shrink-0 select-none ${IS_MACOS ? 'pl-[72px]' : ''}`}
            data-tauri-drag-region
         >
            {/* Left section: fixed width when panel is open (aligns with Projects Panel
                right edge), or auto width when panel is collapsed / not yet measured */}
            <div
               className="shrink-0 flex items-center px-2"
               style={leftPanelWidth > 0 ? { width: `${leftSectionWidth}px` } : undefined}
               data-tauri-drag-region
            >
                <div className="relative shrink-0 px-2 py-1 flex items-center gap-1" data-tauri-drag-region>
                    <img src={neekoIcon} className="w-5 h-5 object-contain mx-1" alt="Neeko" data-tauri-drag-region />
                </div>
               {/*<img src={neekoIcon} className="w-5 h-5 object-contain mx-1 shrink-0" alt="Neeko" data-tauri-drag-region />*/}
               {/* Spacer only when panel is open — pushes project name to right edge */}
               {leftPanelWidth > 0 && <div className="flex-1" data-tauri-drag-region />}
               {/* Project name + branch — always visible */}
               <div className="flex items-center gap-3 shrink-0 ml-2" data-tauri-drag-region>
                  {currentProjectName && (
                     <span
                        className="flex items-center shrink-0"
                        data-tauri-drag-region
                        title={currentProjectName}
                     >
                        {/*
                         * 标题栏里不再画项目头像 —— 同样的 letter avatar 在
                         * sidebar 项目行里已经渲染过一次，标题栏只负责"当前项目"
                         * 的文字身份，让视觉焦点收敛到项目名 + 分支。
                         */}
                        <span
                           className="text-[var(--font-size)] font-medium text-text-primary max-w-[220px] truncate"
                           style={{
                              color: getAvatarStyle({ name: currentProjectName, color: currentAvatarColor }).color,
                           }}
                        >
                           {currentProjectName}
                        </span>
                     </span>
                  )}
                  {currentBranch && (
                     <TitleBarBranchSwitcher
                        currentBranch={currentBranch}
                        branches={branches}
                        isWorktreeMode={isWorktreeMode}
                        isSwitching={isBranchSwitching}
                        onCheckoutBranch={onCheckoutBranch}
                        onNewBranch={handleNewBranch}
                     />
                  )}
               </div>
            </div>

            {/* Center spacer (draggable) */}
            <div className="flex-1" data-tauri-drag-region />

            {/* Right: OpenIdeButton + TaskRunButton + WindowControls */}
            <div className="flex items-center gap-2 shrink-0 px-2">
               <OpenIdeButton />
               <TaskRunButton />
               {!IS_MACOS && <WindowControls />}
            </div>
         </div>

         {/* New Branch dialog — owned by TitleBar, invisible to App */}
         {dialogState && (
            <GitDialog
               dialog={dialogState}
               onClose={handleDialogClose}
               onRefreshGit={handleDialogRefreshGit}
            />
         )}
      </>
   );
}

export default React.memo(TitleBar);
