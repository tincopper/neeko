import React, { useEffect } from "react";
import type { Project } from '@/shared/types';
import type { DialogType } from "@/features/git/components/GitDialog";
import { FolderGitIcon, GitLogoIcon } from "@/shared/components/icons";

interface ProjectGitMenuProps {
  project: Project;
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** Trigger button shown in hover slot. Caller renders chevron / icon themselves. */
  trigger: React.ReactNode;
  onCommit?: (projectId: string) => void;
  onPush?: (projectId: string) => void;
  onPull?: (projectId: string) => void;
  onOpenDialog: (type: DialogType, e: React.MouseEvent) => void;
}

/**
 * ProjectGitMenu —— 项目 hover 槽位的 Git 下拉。
 * - 包含 Commit / Push / Pull / New Branch / New Worktree
 * - 由父组件控制 open 状态（与 trigger 按钮共享一个 anchor）
 * - 仅当存在任一 Git 操作可用时调用方才会渲染
 */
const ProjectGitMenu: React.FC<ProjectGitMenuProps> = ({
  project,
  open,
  setOpen,
  trigger,
  onCommit,
  onPush,
  onPull,
  onOpenDialog,
}) => {
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open, setOpen]);

  const gitInfo = project.git_info;

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Git actions"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-md min-w-[150px] z-[1000] shadow-lg overflow-hidden">
          {onCommit && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onCommit(project.id);
              }}
            >
              <GitLogoIcon size={12} />
              Commit Changes
            </div>
          )}
          {gitInfo && (
            <>
              {onPush && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onPush(project.id);
                  }}
                >
                  <GitLogoIcon size={12} />
                  Push
                </div>
              )}
              {onPull && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onPull(project.id);
                  }}
                >
                  <GitLogoIcon size={12} />
                  Pull
                </div>
              )}
              <div className="border-t border-border my-0.5" />
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                onClick={(e) => {
                  setOpen(false);
                  onOpenDialog("new-branch", e);
                }}
              >
                <GitLogoIcon size={12} />
                New Branch
              </div>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                onClick={(e) => {
                  setOpen(false);
                  onOpenDialog("new-worktree", e);
                }}
              >
                <FolderGitIcon size={12} />
                New Worktree
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(ProjectGitMenu);
