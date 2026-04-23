import React, { useState, useRef, useCallback } from "react";
import { getIdeIconByCommand } from "../../utils/idePresets";
import ContextMenu, { type ContextMenuItem } from "../project/ContextMenu";
import ProjectSettingsDialog from "../project/ProjectSettingsDialog";
import {
   CloseTerminalIcon,
   FolderGitIcon,
   GitLogoIcon,
} from "../icons";
import ProjectBody from "./ProjectBody";
import { getAvatarStyle } from "./utils";
import type { ProjectItemCardProps } from "./types";

const ProjectItemCard: React.FC<ProjectItemCardProps> = React.memo(
   ({
      project,
      isActive,
      hasSession,
      onSelectProject,
      onToggleCollapsed,
      onSelectFile,
      onCheckoutBranch,
      onCommitRenameBranch,
      onOpenWorktreeTerminal,
      onCommitRenameWorktree,
      onRemoveWorktree,
      onRemoveProject,
      onOpenIde,
      onOpenDialog,
      currentBranch,
      ideCommandOverrides,
      onOpenSettings,
      onRefresh,
      agents,
      config,
      onSaveProjectSettings,
      onRefreshGit,
      onShowToast,
      onGetWorktreeChangedFiles,
      onIsWorktreeDirty,
      onGetWorktreeFileDiff,
   }) => {
      const [collapsed, setCollapsed] = useState(true);
      const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
      const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
      const [renameBranchValue, setRenameBranchValue] = useState("");
      const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null);
      const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
      const [gitMenuOpen, setGitMenuOpen] = useState(false);
      const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const renameInputRef = useRef<HTMLInputElement>(null);
      const renameWtInputRef = useRef<HTMLInputElement>(null);
      const gitInfoLoaded = useRef(false);

      const gitInfo = project.git_info;

      React.useEffect(() => {
         if (gitInfo && !gitInfoLoaded.current) {
            gitInfoLoaded.current = true;
            setCollapsed(false);
         }
      }, [gitInfo]);

      const toggleSection = useCallback((section: string, e: React.MouseEvent) => {
         e.stopPropagation();
         setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
      }, []);

      const handleStartRenameBranch = useCallback((branch: string, _currentBranch: string) => {
         setRenamingBranch(branch);
         setRenameBranchValue(branch);
         setTimeout(() => renameInputRef.current?.focus(), 0);
      }, []);

      const handleCommitRenameBranch = useCallback(() => {
         if (renamingBranch && renameBranchValue.trim() && renameBranchValue !== renamingBranch) {
            onCommitRenameBranch(renamingBranch, renameBranchValue.trim());
         }
         setRenamingBranch(null);
      }, [renamingBranch, renameBranchValue, onCommitRenameBranch]);

      const handleStartRenameWorktree = useCallback((path: string) => {
         setRenamingWorktree(path);
         const name = path.split("/").pop() || "";
         setRenameWorktreeValue(name);
         setTimeout(() => renameWtInputRef.current?.focus(), 0);
      }, []);

      const handleCommitRenameWorktree = useCallback(() => {
         if (renamingWorktree && renameWorktreeValue.trim()) {
            onCommitRenameWorktree(renamingWorktree, renameWorktreeValue.trim());
         }
         setRenamingWorktree(null);
      }, [renamingWorktree, renameWorktreeValue, onCommitRenameWorktree]);

      React.useEffect(() => {
         if (!gitMenuOpen) {
            return;
         }
         const handler = () => setGitMenuOpen(false);
         document.addEventListener("click", handler);
         return () => document.removeEventListener("click", handler);
      }, [gitMenuOpen]);

      const handleContextMenu = (e: React.MouseEvent) => {
         e.preventDefault();
         e.stopPropagation();
         setContextMenu({ x: e.clientX, y: e.clientY });
      };

      const buildContextMenuItems = (): ContextMenuItem[] => {
         const items: ContextMenuItem[] = [];

         if (project.selected_ide && onOpenIde) {
            items.push({
               label: "Open in IDE",
               shortcut: "Ctrl+O",
               action: () => onOpenIde(),
            });
         }

         if (project.git_info) {
            const branches = project.git_info.branches;
            items.push({
               label: "New Branch",
               icon: GitLogoIcon,
               action: () => {
                  setGitMenuOpen(false);
                  onOpenDialog?.("new-branch", branches);
               },
            });
            items.push({
               label: "New Worktree",
               icon: FolderGitIcon,
               action: () => {
                  setGitMenuOpen(false);
                  onOpenDialog?.("new-worktree", branches);
               },
            });
         }

         if (onRefresh) {
            items.push({
               label: "Refresh Terminal",
               shortcut: "Ctrl+R",
               action: () => onRefresh(),
            });
         }

         items.push({ label: "", separator: true, action: () => { } });

         if (onOpenSettings && config) {
            items.push({
               label: "Project Settings",
               action: () => setSettingsOpen(true),
            });
         }

         items.push({
            label: "Remove Project",
            action: () => onRemoveProject(),
            danger: true,
         });

         return items;
      };

      return (
         <div className={`gh-project mb-0.5 rounded-md overflow-visible ${isActive ? "active" : ""}`}>
            <div
               className={`gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover ${isActive ? "bg-bg-tertiary" : ""
                  }`}
               onClick={() => {
                  setCollapsed((v) => !v);
                  onToggleCollapsed?.();
               }}
               onContextMenu={handleContextMenu}
            >
               <span
                  className="w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase cursor-pointer"
                  style={getAvatarStyle(project.name)}
                  onClick={(e) => {
                     e.stopPropagation();
                     setCollapsed((v) => !v);
                  }}
               >
                  {project.name.charAt(0).toUpperCase()}
               </span>
               <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
                  <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
                     {project.name}
                  </span>
               </div>

               {onOpenIde && (
                  <button
                     className={`gh-ide-btn bg-transparent border-none cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 ml-0.5 text-text-muted hover:!text-accent-blue shrink-0 ${isActive
                           ? "opacity-0 group-hover:opacity-100"
                           : "opacity-0 pointer-events-none"
                        }`}
                     title={
                        project.selected_ide
                           ? `Open in IDE (Ctrl+O)\n${project.selected_ide}`
                           : "Open in IDE (Ctrl+O)"
                     }
                     onClick={(e) => {
                        e.stopPropagation();
                        onOpenIde();
                     }}
                  >
                     <img
                        src={getIdeIconByCommand(project.selected_ide ?? null, ideCommandOverrides)}
                        className="w-3.5 h-3.5 object-contain block"
                        alt=""
                     />
                  </button>
               )}

               <div
                  className={`gh-project-actions flex items-center gap-0.5 shrink-0 ${isActive
                        ? "opacity-0 group-hover:opacity-100"
                        : "opacity-0 pointer-events-none"
                     } transition-opacity duration-150`}
                  onClick={(e) => e.stopPropagation()}
               >
                  {gitInfo && onOpenDialog && (
                     <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button
                           className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
                           onClick={(e) => {
                              e.stopPropagation();
                              setGitMenuOpen((v) => !v);
                           }}
                           title="Git actions"
                        >
                           <GitLogoIcon size={11} />
                        </button>
                        {gitMenuOpen && (
                           <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-md min-w-[140px] z-[1000] shadow-lg overflow-hidden">
                              <div
                                 className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                                 onClick={() => {
                                    setGitMenuOpen(false);
                                    onOpenDialog("new-branch", gitInfo.branches);
                                 }}
                              >
                                 <GitLogoIcon size={12} />
                                 New Branch
                              </div>
                              <div
                                 className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                                 onClick={() => {
                                    setGitMenuOpen(false);
                                    onOpenDialog("new-worktree", gitInfo.branches);
                                 }}
                              >
                                 <FolderGitIcon size={12} />
                                 New Worktree
                              </div>
                           </div>
                        )}
                     </div>
                  )}
                  {hasSession && (
                     <button
                        className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
                        title="Close terminal"
                        onClick={() => onRemoveProject()}
                     >
                        <CloseTerminalIcon size={10} />
                     </button>
                  )}
                  <button
                     className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150"
                     title="Remove project"
                     onClick={() => onRemoveProject()}
                  >
                     ×
                  </button>
               </div>
            </div>

            {!collapsed && (
               <ProjectBody
                  gitInfo={gitInfo ?? null}
                  projectId={project.id}
                  expandedSections={expandedSections}
                  renamingBranch={renamingBranch}
                  renameBranchValue={renameBranchValue}
                  renamingWorktree={renamingWorktree}
                  renameWorktreeValue={renameWorktreeValue}
                  onToggleSection={toggleSection}
                  onCheckoutBranch={(branch) => onCheckoutBranch(branch)}
                  onStartRenameBranch={handleStartRenameBranch}
                  onRenameBranchChange={setRenameBranchValue}
                  onCommitRenameBranch={handleCommitRenameBranch}
                  onCancelRename={() => setRenamingBranch(null)}
                  onSelectFile={onSelectFile}
                  onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                  onStartRenameWorktree={handleStartRenameWorktree}
                  onRenameWorktreeChange={setRenameWorktreeValue}
                  onCommitRenameWorktree={handleCommitRenameWorktree}
                  onRemoveWorktree={onRemoveWorktree}
                  onCancelRenameWorktree={() => setRenamingWorktree(null)}
                  renameInputRef={renameInputRef as React.RefObject<HTMLInputElement>}
                  renameWtInputRef={renameWtInputRef as React.RefObject<HTMLInputElement>}
                  currentBranch={currentBranch}
                  onSelectProject={() => onSelectProject()}
                  isActive={isActive}
                  onRefreshGit={onRefreshGit}
                  onShowToast={onShowToast}
                  onOpenDialog={onOpenDialog}
                  onGetWorktreeChangedFiles={onGetWorktreeChangedFiles}
                  onIsWorktreeDirty={onIsWorktreeDirty}
                  onGetWorktreeFileDiff={onGetWorktreeFileDiff}
               />
            )}

            {contextMenu && (
               <ContextMenu
                  position={contextMenu}
                  onClose={() => setContextMenu(null)}
                  items={buildContextMenuItems()}
               />
            )}

            {settingsOpen && config && (
               <ProjectSettingsDialog
                  projectId={project.id}
                  projectName={project.name}
                  currentAgent={project.selected_agent ?? null}
                  currentIde={project.selected_ide ?? null}
                  agents={agents ?? []}
                  config={config}
                  onClose={() => setSettingsOpen(false)}
                  onSave={(agentId, ideCmd) => {
                     onSaveProjectSettings?.(agentId, ideCmd);
                     setSettingsOpen(false);
                  }}
               />
            )}
         </div>
      );
   },
);

ProjectItemCard.displayName = "ProjectItemCard";

export default ProjectItemCard;
