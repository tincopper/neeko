import React, { useMemo } from "react";
import type { Project } from "../../types";
import WorktreeList from "./WorktreeList";
import SessionRow from "./SessionRow";
import { useAppStore } from "../../store/appStore";
import { aheadBehindKey } from "../../utils/aheadBehindKey";

interface ProjectGitSectionProps {
  project: Project;
  isActive: boolean;
  /** 由父级派生的 Ctrl+N shortcut（仅 active 行展示） */
  shortcut?: string;
  actions: {
    onSelectProject: (projectId: string) => void;
    onRefreshGit: (projectId: string) => void;
    onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
    onShowToast?: (message: string, type?: "info" | "error") => void;
  };
}

/**
 * ProjectGitSection —— 渲染项目 group 展开后的 session 列表：
 * 1. 主终端行（"local"）
 * 2. 每个 worktree 行（由 WorktreeList 负责，附带 +A -D chip 与 trash/rename 控件）
 */
function ProjectGitSection({ project, isActive, shortcut, actions }: ProjectGitSectionProps) {
  const { onSelectProject, onRefreshGit, onOpenWorktreeTerminal, onShowToast } = actions;

  const worktrees = project.git_info?.worktrees ?? [];
  const activeWorktreePath = useAppStore((s) => s.activeWorktreePath);
  const aheadBehind = useAppStore(
    (s) => s.aheadBehind[aheadBehindKey("local", project.id, project.id)],
  );

  // local 主终端的 +A -D = project.changed_files 聚合
  const localChanges = useMemo(() => {
    const files = project.git_info?.changed_files ?? [];
    if (files.length === 0) return undefined;
    const add = files.reduce((s, f) => s + f.additions, 0);
    const del = files.reduce((s, f) => s + f.deletions, 0);
    if (add === 0 && del === 0) return undefined;
    return { add, del };
  }, [project.git_info?.changed_files]);

  const localActive = isActive && !activeWorktreePath;

  return (
    <div>
      <SessionRow
        kind="local"
        label="local"
        branch={project.git_info?.current_branch}
        isActive={localActive}
        ahead={localActive ? aheadBehind?.ahead : undefined}
        changes={localChanges}
        shortcut={localActive ? shortcut : undefined}
        title="Open primary terminal"
        onClick={(e) => {
          e.stopPropagation();
          onSelectProject(project.id);
        }}
      />

      <WorktreeList
        worktrees={worktrees}
        projectId={project.id}
        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
        onRefreshGit={onRefreshGit}
        onShowToast={onShowToast}
      />
    </div>
  );
}

export default React.memo(ProjectGitSection);
