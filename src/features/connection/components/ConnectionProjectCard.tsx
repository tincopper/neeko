import React, { useCallback, useMemo, useState } from "react";
import { renameWorktree, removeWorktree, getWorktreeChangedFiles, isWorktreeDirty } from "../../git/api/gitApi";
import {
   DraggableProjectItem,
   ProjectGroup,
   SessionRow,
} from "@/features/project/components";
import { useProjectItemDrag } from "@/features/project/components/useProjectItemDrag";
import ContextMenu, { type ContextMenuItem } from "@/features/project/components/ContextMenu";
import ProjectSettingsDialog from "@/features/project/components/ProjectSettingsDialog";
import ConnectionWorktreeList from "./ConnectionWorktreeList";
import type { ConnectionProjectCardProps } from "./types";
import type { FileChange } from '@/shared/types';
import { getIdeIconByCommand } from '@/shared/utils/idePresets';
import ConfirmDialog from "@/shared/components/ConfirmDialog";
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useGitStore } from '@/features/git/store';
import { useConnectionStore } from "../store";
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';

const LOG_TAG: Record<string, string> = {
   wsl: "[WSL]",
   remote: "[SSH]",
};

const ConnectionProjectCard: React.FC<ConnectionProjectCardProps> = React.memo(
   ({
      project,
      entryId,
      source,
      isActive,
      isLast,
      onSelectProject,
      onRemoveProject,
      onOpenIde,
      onOpenWorktreeTerminal,
      ideCommandOverrides,
      onOpenSettings,
      onRefresh,
      agents,
      config,
      onSaveProjectSettings,
      onDragEnd,
   }) => {
      // Extract primitives for stable useCallback dependencies
      const isWsl = source.type === "wsl";
      const distro = source.type === "wsl" ? source.distro : "";
      const remoteEntryId = source.type === "remote" ? source.entryId : "";
      const host = source.type === "remote" ? source.host : "";
      const remoteInvoke = source.type === "remote" ? source.invokeRemoteGit : undefined;
      const logTag = LOG_TAG[source.type] ?? "";

      // connectionId: scope identifier used for most callbacks (worktree, IDE)
      const connectionId = isWsl ? distro : remoteEntryId;
      // selectProjectId: scope identifier for onSelectProject (WSL uses distro, Remote uses host)
      const selectProjectId = isWsl ? distro : host;

      // Active worktree path lives in connection-specific store fields
      const activeWslWorktreePath = useWorktreeStore((s) => s.activeWslWorktreePath);
      const activeRemoteWorktreePath = useWorktreeStore((s) => s.activeRemoteWorktreePath);
      const activeWorktreePath = isWsl ? activeWslWorktreePath : activeRemoteWorktreePath;

      // ahead/behind 仅在 active 项目时显�?
      const aheadKey = aheadBehindKey(
         isWsl ? "wsl" : "remote",
         isWsl ? distro : remoteEntryId,
         project.id,
      );
      const aheadBehind = useGitStore((s) => s.aheadBehind[aheadKey]);

      const [collapsed, setCollapsed] = useState(true);
      const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [confirmRemove, setConfirmRemove] = useState(false);
      const gitInfoLoaded = React.useRef(false);
      const gitInfo = project.git_info;

      // Auto-expand when git_info first arrives (parity with old ProjectItemCard)
      React.useEffect(() => {
         if (gitInfo && !gitInfoLoaded.current) {
            gitInfoLoaded.current = true;
            setCollapsed(false);
         }
      }, [gitInfo]);

      // Drag support
      const {
         isDragging,
         dragOffset,
         dropIndicator,
         handlePointerDown,
         handlePointerMove,
         handlePointerUp,
         handlePointerCancel,
      } = useProjectItemDrag({ projectId: project.id, onDragEnd });

      const handleOpenWorktreeTerminal = useCallback(
         (wtPath: string, branch: string) => {
            onOpenWorktreeTerminal?.(connectionId, wtPath, branch);
         },
         [onOpenWorktreeTerminal, connectionId],
      );

      const remoteAuthStore = useConnectionStore((s) => s.remoteAuthStore);
      const remoteEntries = useConnectionStore((s) => s.remoteEntries);

      const getRemoteTransport = useCallback(() => {
         const auth = remoteAuthStore.get(remoteEntryId);
         const entry = remoteEntries.find((e) => e.id === remoteEntryId);
         if (!auth || !entry) return null;
         return {
            Remote: {
               host: entry.host,
               port: entry.port,
               username: entry.username,
               auth,
               project_path: project.path,
            },
         };
      }, [remoteAuthStore, remoteEntries, remoteEntryId, project.path]);

      const handleRenameWorktree = useCallback(
         (oldPath: string, newName: string) => {
            const newFullPath = oldPath.replace(/[^/\\]+$/, newName);
            if (isWsl) {
               renameWorktree(
                  { Wsl: { distro, project_path: project.path } } as any,
                  oldPath,
                  newFullPath,
               ).catch(console.error);
            } else if (remoteInvoke) {
               const rt = getRemoteTransport();
               if (rt) {
                  renameWorktree(rt, oldPath, newFullPath).catch(console.error);
               }
            }
         },
         [isWsl, distro, project.path, remoteInvoke, getRemoteTransport],
      );

      const handleRemoveWorktree = useCallback(
         (wtPath: string, _branch: string) => {
            if (isWsl) {
               removeWorktree(
                  { Wsl: { distro, project_path: project.path } } as any,
                  wtPath,
               ).catch((e: unknown) => {
                  console.error(`${logTag} Failed to remove worktree:`, e);
               });
            } else if (remoteInvoke) {
               const rt = getRemoteTransport();
               if (rt) {
                  removeWorktree(rt, wtPath).catch((e: unknown) => {
                     console.error(`${logTag} Failed to remove worktree:`, e);
                  });
               }
            }
         },
         [isWsl, distro, project.path, remoteInvoke, getRemoteTransport, logTag],
      );

      const handleRemove = useCallback(() => {
         setConfirmRemove(true);
      }, []);

      const handleOpenIde = useMemo(
         () =>
            onOpenIde && project.selected_ide
               ? () => onOpenIde(connectionId, project.path, project.selected_ide ?? "")
               : undefined,
         [onOpenIde, connectionId, project.path, project.selected_ide],
      );

      const handleGetWorktreeChangedFiles = useCallback(
         (worktreePath: string): Promise<FileChange[]> => {
            if (isWsl) {
               return getWorktreeChangedFiles(
                  { Wsl: { distro, project_path: project.path } },
                  worktreePath,
               );
            }
            if (remoteInvoke) {
               const rt = getRemoteTransport();
               if (rt) {
                  return getWorktreeChangedFiles(rt, worktreePath);
               }
            }
            return Promise.resolve([] as FileChange[]);
         },
         [isWsl, distro, project.path, remoteInvoke, getRemoteTransport],
      );

      const handleIsWorktreeDirty = useCallback(
         (worktreePath: string): Promise<boolean> => {
            if (isWsl) {
               return isWorktreeDirty(
                  { Wsl: { distro, project_path: project.path } },
                  worktreePath,
               );
            }
            if (remoteInvoke) {
               const rt = getRemoteTransport();
               if (rt) {
                  return isWorktreeDirty(rt, worktreePath);
               }
            }
            return Promise.resolve(false);
         },
         [isWsl, distro, project.path, remoteInvoke, getRemoteTransport],
      );

      const handleContextMenu = (e: React.MouseEvent) => {
         e.preventDefault();
         e.stopPropagation();
         setContextMenu({ x: e.clientX, y: e.clientY });
      };

      const buildContextMenuItems = (): ContextMenuItem[] => {
         const items: ContextMenuItem[] = [];

         if (handleOpenIde) {
            items.push({
               label: "Open in IDE",
               shortcut: "Ctrl+O",
               action: () => handleOpenIde(),
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
            action: () => handleRemove(),
            danger: true,
         });

         return items;
      };

      // ── derived values for ProjectGroup / SessionRow ──
      const worktrees = gitInfo?.worktrees ?? [];
      const sessionCount = 1 + worktrees.length;
      const ideIconSrc = project.selected_ide
         ? getIdeIconByCommand(project.selected_ide, ideCommandOverrides)
         : undefined;

      // local 主终端的 +A -D = project.changed_files 聚合
      const localChanges = useMemo(() => {
         const files = gitInfo?.changed_files ?? [];
         if (files.length === 0) return undefined;
         const add = files.reduce((s, f) => s + f.additions, 0);
         const del = files.reduce((s, f) => s + f.deletions, 0);
         if (add === 0 && del === 0) return undefined;
         return { add, del };
      }, [gitInfo?.changed_files]);

      const localActive = isActive && !activeWorktreePath;

      return (
         <DraggableProjectItem
            dragId={project.id}
            isDragging={isDragging}
            dragOffset={dragOffset}
            dropIndicator={dropIndicator}
            isActive={isActive}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
         >
            <ProjectGroup
               name={project.name}
               avatarColor={project.avatar_color}
               sessionCount={sessionCount}
               expanded={!collapsed}
               isActive={isActive}
               isLast={isLast}
               ideIconSrc={ideIconSrc}
               actions={{
                  onToggle: () => setCollapsed((v) => !v),
                  onContextMenu: handleContextMenu,
                  onOpenIde: handleOpenIde,
                  onRemove: handleRemove,
               }}
            >
               <div>
                  <SessionRow
                     kind="local"
                     label="local"
                     branch={gitInfo?.current_branch}
                     isActive={localActive}
                     ahead={localActive ? aheadBehind?.ahead : undefined}
                     changes={localChanges}
                     title="Open primary terminal"
                     onClick={(e) => {
                        e.stopPropagation();
                        onSelectProject(selectProjectId, project);
                     }}
                  />
                  <ConnectionWorktreeList
                     worktrees={worktrees}
                     activeWorktreePath={isActive ? activeWorktreePath : null}
                     onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
                     onCommitRenameWorktree={handleRenameWorktree}
                     onRemoveWorktree={handleRemoveWorktree}
                     onGetWorktreeChangedFiles={handleGetWorktreeChangedFiles}
                     onIsWorktreeDirty={handleIsWorktreeDirty}
                  />
               </div>
            </ProjectGroup>

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

            <ConfirmDialog
               open={confirmRemove}
               onOpenChange={setConfirmRemove}
               title="Remove Project"
               description={
                  <>
                     <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                        Are you sure you want to remove <strong className="text-accent-blue">{project.name}</strong>?
                     </p>
                     <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
                        <span className="text-text-muted break-all">{project.path}</span>
                     </div>
                  </>
               }
               confirmLabel="Remove"
               onConfirm={() => {
                  setConfirmRemove(false);
                  onRemoveProject(entryId, project.id);
               }}
               danger
            />
         </DraggableProjectItem>
      );
   },
);

ConnectionProjectCard.displayName = "ConnectionProjectCard";

export default ConnectionProjectCard;
