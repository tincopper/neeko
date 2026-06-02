import React, { useState, useRef, useEffect, useCallback } from "react";
import type { FileChange, Worktree } from '@/shared/types';
import { BranchIcon, TrashIcon, FolderGitIcon } from "@/shared/components/icons";
import { cn } from '@/lib/utils';
import SessionChips from "@/features/project/components/SessionChips";
import ConfirmDialog from "@/shared/components/ConfirmDialog";

interface ConnectionWorktreeListProps {
   worktrees: Worktree[];
   /** 当前激活的 worktree 路径（来�?connection-specific store 字段�?*/
   activeWorktreePath: string | null;
   /** 点击 worktree 行：触发外部 onOpenWorktreeTerminal */
   onOpenWorktreeTerminal: (worktreePath: string, branch: string) => void;
   /** 双击 worktree label：开始重命名（提�?newName 由父级处理） */
   onCommitRenameWorktree: (oldPath: string, newName: string) => void;
   /** 删除 worktree（含分支�?*/
   onRemoveWorktree: (worktreePath: string, branch: string) => void;
   /** 懒加�?worktree changed_files（用�?+A -D chip�?*/
   onGetWorktreeChangedFiles?: (worktreePath: string) => Promise<FileChange[]>;
   /** 检�?worktree 是否 dirty */
   onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
}

interface ChangeStat {
   add: number;
   del: number;
}

const ConnectionWorktreeList: React.FC<ConnectionWorktreeListProps> = ({
   worktrees,
   activeWorktreePath,
   onOpenWorktreeTerminal,
   onCommitRenameWorktree,
   onRemoveWorktree,
   onGetWorktreeChangedFiles,
   onIsWorktreeDirty,
}) => {
   const [changeStats, setChangeStats] = useState<Record<string, ChangeStat>>({});
   const [renaming, setRenaming] = useState<string | null>(null);
   const [renameValue, setRenameValue] = useState("");
   const renameInputRef = useRef<HTMLInputElement>(null);
   const [deleting, setDeleting] = useState<string | null>(null);
   const [confirmDelete, setConfirmDelete] = useState<{ path: string; branch: string; isDirty: boolean } | null>(null);

   useEffect(() => {
      if (renaming !== null && renameInputRef.current) {
         renameInputRef.current.focus();
         renameInputRef.current.select();
      }
   }, [renaming]);

   // 懒加�?worktree changed_files 用于 +A -D chip 聚合�?
   useEffect(() => {
      if (!onGetWorktreeChangedFiles) return;
      let cancelled = false;
      for (const wt of worktrees) {
         if (changeStats[wt.path]) continue;
         onGetWorktreeChangedFiles(wt.path)
            .then((files) => {
               if (cancelled) return;
               const add = files.reduce((s, f) => s + f.additions, 0);
               const del = files.reduce((s, f) => s + f.deletions, 0);
               setChangeStats((prev) => ({ ...prev, [wt.path]: { add, del } }));
            })
            .catch(() => {
               if (cancelled) return;
               setChangeStats((prev) => ({ ...prev, [wt.path]: { add: 0, del: 0 } }));
            });
      }
      return () => {
         cancelled = true;
      };
   }, [worktrees, onGetWorktreeChangedFiles, changeStats]);

   const handleRemove = useCallback(async (worktreePath: string, branch: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onIsWorktreeDirty) {
         try {
            const isDirty = await onIsWorktreeDirty(worktreePath);
            setConfirmDelete({ path: worktreePath, branch, isDirty });
         } catch {
            setConfirmDelete({ path: worktreePath, branch, isDirty: false });
         }
      } else {
         setConfirmDelete({ path: worktreePath, branch, isDirty: false });
      }
   }, [onIsWorktreeDirty]);

   const performRemove = useCallback((worktreePath: string, branch: string) => {
      setConfirmDelete(null);
      setDeleting(worktreePath);
      onRemoveWorktree(worktreePath, branch);
      // Connection backends are async; let parent refresh trigger re-render. Reset spinner safety.
      setTimeout(() => setDeleting(null), 800);
   }, [onRemoveWorktree]);

   const startRename = useCallback((worktreePath: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenaming(worktreePath);
      setRenameValue(worktreePath.split(/[\\/]/).pop() ?? worktreePath);
   }, []);

   const commitRename = useCallback(() => {
      const oldPath = renaming;
      if (!oldPath) return;
      const newName = renameValue.trim();
      setRenaming(null);
      if (!newName) return;
      const oldDirName = oldPath.split(/[\\/]/).pop() ?? "";
      if (newName === oldDirName) return;
      onCommitRenameWorktree(oldPath, newName);
   }, [renaming, renameValue, onCommitRenameWorktree]);

   const cancelRename = useCallback(() => {
      setRenaming(null);
      setRenameValue("");
   }, []);

   if (worktrees.length === 0) return null;

   return (
      <>
         {worktrees.map((wt) => {
            const stats = changeStats[wt.path];
            const isRenaming = renaming === wt.path;
            const isDeleting = deleting === wt.path;
            const isActive = activeWorktreePath === wt.path;
            const label = wt.path.split(/[\\/]/).pop() ?? wt.path;

            return (
               <div
                  key={wt.path}
                  className={cn(
                     "group flex items-center gap-2.5 pl-4 pr-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors",
                     isDeleting && "wt-deleting",
                     isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.025]",
                  )}
                  onClick={(e) => {
                     e.stopPropagation();
                     if (isRenaming || isDeleting) return;
                     onOpenWorktreeTerminal(wt.path, wt.branch);
                  }}
                  title={`${wt.path}\nClick to open terminal`}
               >
                  <span
                     className={cn(
                        "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                        isActive ? "text-text-primary" : "text-text-muted",
                     )}
                     style={{
                        backgroundColor: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                     }}
                  >
                     <FolderGitIcon size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                     {isRenaming ? (
                        <input
                           ref={renameInputRef}
                           className="w-full bg-bg-tertiary border border-accent-blue rounded text-text-primary text-[var(--font-size)] font-semibold px-1 py-0.5 outline-none box-border"
                           value={renameValue}
                           onChange={(e) => setRenameValue(e.target.value)}
                           onBlur={commitRename}
                           onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                 e.preventDefault();
                                 commitRename();
                              }
                              if (e.key === "Escape") {
                                 e.preventDefault();
                                 cancelRename();
                              }
                           }}
                           onClick={(e) => e.stopPropagation()}
                        />
                     ) : (
                        <>
                           <div
                              className="text-[var(--font-size)] font-semibold text-text-primary truncate"
                              onDoubleClick={(e) => startRename(wt.path, e)}
                              title="Double-click to rename"
                           >
                              {label}
                           </div>
                           <div className="text-[0.85em] font-mono text-text-muted truncate">{wt.branch}</div>
                        </>
                     )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                     {stats && (stats.add > 0 || stats.del > 0) && (
                        <SessionChips.Changes add={stats.add} del={stats.del} />
                     )}
                     {isDeleting ? (
                        <span className="wt-spinner" title="Removing..." />
                     ) : (
                        <button
                           data-no-drag
                           className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:!text-accent-red opacity-0 group-hover:opacity-100"
                           onClick={(e) => handleRemove(wt.path, wt.branch, e)}
                           title="Remove worktree and branch"
                        >
                           <TrashIcon size={12} />
                        </button>
                     )}
                  </div>
               </div>
            );
         })}
         {confirmDelete && (
            <ConfirmDialog
               open={true}
               onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
               title="Remove Worktree"
               description={
                  <>
                     {confirmDelete.isDirty ? (
                        <p className="text-[13px] text-text-primary mb-3 leading-relaxed text-accent-yellow bg-accent-yellow/[0.08] p-2 px-3 rounded-md border-l-[3px] border-accent-yellow">
                           This worktree has uncommitted changes. Removing it will discard all local changes. Are you sure?
                        </p>
                     ) : (
                        <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                           Remove worktree <strong className="text-accent-blue">{confirmDelete.path.split(/[\\/]/).pop()}</strong> and delete branch <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
                        </p>
                     )}
                     <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
                        <span className="text-text-muted break-all">{confirmDelete.path}</span>
                        <span className="flex items-center gap-1 text-accent-green">
                           <BranchIcon size={11} /> {confirmDelete.branch}
                        </span>
                     </div>
                  </>
               }
               confirmLabel={confirmDelete.isDirty ? "Force Remove" : "Remove"}
               onConfirm={() => performRemove(confirmDelete.path, confirmDelete.branch)}
               danger
            />
         )}
      </>
   );
};

export default React.memo(ConnectionWorktreeList);
