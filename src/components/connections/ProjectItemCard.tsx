import React, { useState, useRef, useCallback } from "react";
import { getIdeIconByCommand } from "../../utils/idePresets";
import ContextMenu, { type ContextMenuItem } from "../project/ContextMenu";
import ProjectSettingsDialog from "../project/ProjectSettingsDialog";
import {
   CloseTerminalIcon,
} from "../icons";
import ProjectBody from "./ProjectBody";
import { getAvatarStyle, getProjectInitials } from "./utils";
import type { ProjectItemCardProps } from "./types";

const ProjectItemCard: React.FC<ProjectItemCardProps> = React.memo(
   ({
      project,
      isActive,
      hasSession,
      onSelectProject,
      onToggleCollapsed,
      onSelectFile,
      onOpenWorktreeTerminal,
      onCommitRenameWorktree,
      onRemoveWorktree,
      onRemoveProject,
      onOpenIde,
      ideCommandOverrides,
      onOpenSettings,
      onRefresh,
      agents,
      config,
      onSaveProjectSettings,
      onShowToast,
      onGetWorktreeChangedFiles,
      onIsWorktreeDirty,
   }) => {
      const [collapsed, setCollapsed] = useState(true);
      const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
      const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null);
      const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
      const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
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

         if (onRefresh) {
            items.push({
               label: "Refresh Terminal",
                shortcut: "Ctrl+Alt+R",
               action: () => onRefresh(),
            });
         }

         items.push({ separator: true });

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
                  {getProjectInitials(project.name)}
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
                   renamingWorktree={renamingWorktree}
                   renameWorktreeValue={renameWorktreeValue}
                   onToggleSection={toggleSection}
                   onSelectFile={onSelectFile}
                   onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                   onStartRenameWorktree={handleStartRenameWorktree}
                   onRenameWorktreeChange={setRenameWorktreeValue}
                   onCommitRenameWorktree={handleCommitRenameWorktree}
                   onRemoveWorktree={onRemoveWorktree}
                   onCancelRenameWorktree={() => setRenamingWorktree(null)}
                   renameWtInputRef={renameWtInputRef as React.RefObject<HTMLInputElement>}
                   onSelectProject={() => onSelectProject()}
                   isActive={isActive}
                   onShowToast={onShowToast}
                   onGetWorktreeChangedFiles={onGetWorktreeChangedFiles}
                   onIsWorktreeDirty={onIsWorktreeDirty}
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
