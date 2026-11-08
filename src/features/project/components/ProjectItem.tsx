import { useSortable } from '@dnd-kit/sortable';
import React, { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import DeleteConfirmDialog from '@/shared/components/DeleteConfirmDialog';
import type { DialogType } from '@/shared/components/GitDialog';
import { MoreVerticalIcon } from '@/shared/components/icons';
import ProjectGroup from '@/shared/components/ProjectGroup';
import { useProjectStore } from '@/shared/store/projectStore';
import { getIdeIconByCommand } from '@/shared/utils/idePresets';
import { sortableCardStyle } from '@/shared/utils/sortableCardStyle';

import { setProjectCollapsed as setProjectCollapsedApi } from '../api/projectApi';

import ContextMenu from './ContextMenu';
import ProjectGitMenu from './ProjectGitMenu';
import ProjectGitSection from './ProjectGitSection';
import type { ProjectItemProps } from './projectItemTypes';
import ProjectSettingsDialog from './ProjectSettingsDialog';
import { useProjectItemMenu } from './useProjectItemMenu';

interface ProjectItemViewExtras {
  /** 当前项目卡是否处于项目列表的最后一个（决定是否�?hairline�?*/
}

const ProjectItem: React.FC<ProjectItemProps & ProjectItemViewExtras> = ({
  project,
  isActive,
  actions,
  viewConfig,
}) => {
  const {
    onSelectProject,
    onRemoveProject,
    onRefreshGit,
    onOpenDialog,
    onCommit,
    onPush,
    onPull,
    onOpenIde,
    onOpenWorktreeTerminal,
    onOpenSettings,
    onRefresh,
    onShowToast,
    onSaveProjectSettings,
  } = actions;

  const ideCommandOverrides = viewConfig?.ideCommandOverrides;
  const agents = viewConfig?.agents;
  const config = viewConfig?.config;

  const [projectCollapsed, setProjectCollapsed] = useState(project.collapsed ?? true);

  const [confirmRemove, setConfirmRemove] = useState(false);

  const projects = useProjectStore((s) => s.projects);
  const shortcut = useMemo(() => {
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx < 0 || idx >= 9) return undefined;
    return `Ctrl+${idx + 1}`;
  }, [projects, project.id]);

  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id });

  const {
    gitMenuOpen,
    setGitMenuOpen,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    contextMenuItems,
    settingsOpen,
    setSettingsOpen,
  } = useProjectItemMenu({
    project,
    onOpenDialog,
    onOpenIde,
    onRefresh,
    onOpenSettings,
    onRemoveProject: () => setConfirmRemove(true),
    onCommit,
    onPush,
    onPull,
    hasConfig: Boolean(config),
  });

  const toggleCollapsed = async () => {
    const newCollapsed = !projectCollapsed;
    setProjectCollapsed(newCollapsed);
    try {
      await setProjectCollapsedApi(project.id, newCollapsed);
    } catch (e) {
      console.error('Failed to save collapsed state:', e);
    }
  };

  const openDialog = (type: DialogType, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onOpenDialog({
      type,
      projectId: project.id,
      branches: project.git_info?.branches ?? [],
      ...(type === 'new-worktree' ? { projectPath: project.path } : {}),
    });
  };

  const sessionCount = 1 + (project.git_info?.worktrees.length ?? 0);
  const hasGitActions = !!(onCommit || (project.git_info && (onPush || onPull)));
  const ideIconSrc = project.selected_ide
    ? getIdeIconByCommand(project.selected_ide, ideCommandOverrides)
    : undefined;

  const style = sortableCardStyle({ isDragging, transition, transform });

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-project-id={project.id}
      className={cn(
        // 方案 C（2026-11-08 定案）：项目卡 = 岛式容器（淡起底的圆角块），岛间距 6px
        // 承担项目分隔（旧 `mb-0.5` + 无底通栏卡废止）。岛内缩进由 `ProjectGroup` 给。
        'relative mb-1.5 rounded-lg bg-bg-secondary overflow-visible',
        isDragging && 'opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50',
        !isDragging && 'cursor-grab',
      )}
    >
      <ProjectGroup
        name={project.name}
        avatarColor={project.avatar_color}
        sessionCount={sessionCount}
        expanded={!projectCollapsed}
        ideIconSrc={ideIconSrc}
        forceShowActions={gitMenuOpen}
        dragHandleRef={setActivatorNodeRef}
        dragHandleProps={listeners}
        actions={{
          onToggle: () => void toggleCollapsed(),
          onContextMenu: handleContextMenu,
          onAddWorktree: project.git_info
            ? () =>
                onOpenDialog({
                  type: 'new-worktree',
                  projectId: project.id,
                  branches: project.git_info?.branches ?? [],
                  projectPath: project.path,
                })
            : undefined,
          onOpenIde: project.selected_ide && onOpenIde ? () => onOpenIde(project.id) : undefined,
          onRemove: () => setConfirmRemove(true),
        }}
        headerExtra={
          hasGitActions ? (
            <ProjectGitMenu
              project={project}
              open={gitMenuOpen}
              setOpen={setGitMenuOpen}
              trigger={<MoreVerticalIcon size={13} />}
              onCommit={onCommit}
              onPush={onPush}
              onPull={onPull}
              onOpenDialog={openDialog}
            />
          ) : null
        }
      >
        <ProjectGitSection
          project={project}
          isActive={isActive}
          shortcut={shortcut}
          actions={{
            onSelectProject,
            onRefreshGit,
            onOpenWorktreeTerminal,
            onShowToast,
          }}
        />
      </ProjectGroup>

      {contextMenu && (
        <ContextMenu position={contextMenu} onClose={closeContextMenu} items={contextMenuItems} />
      )}

      {settingsOpen && config && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          currentAgent={project.selected_agents?.[0] ?? null}
          currentIde={project.selected_ide}
          agents={agents ?? []}
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(agentId, ideCmd) => {
            onSaveProjectSettings?.(project.id, agentId, ideCmd);
            setSettingsOpen(false);
          }}
        />
      )}

      <DeleteConfirmDialog
        pending={confirmRemove ? project : null}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={(p) => onRemoveProject(p.id)}
        title="Remove Project"
        confirmLabel="Remove"
        describe={(p) => (
          <>
            <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
              Are you sure you want to remove <strong className="text-accent-blue">{p.name}</strong>
              ?
            </p>
            <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
              <span className="text-text-muted break-all">{p.path}</span>
            </div>
          </>
        )}
      />
    </div>
  );
};

export default React.memo(ProjectItem);
