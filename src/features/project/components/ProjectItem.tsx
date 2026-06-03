import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useMemo, useState } from 'react';

import type { DialogType } from '@/features/git/components/GitDialog';
import { useProjectStore } from '@/features/project/store';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { MoreVerticalIcon } from '@/shared/components/icons';
import { getIdeIconByCommand } from '@/shared/utils/idePresets';

import { setProjectCollapsed as setProjectCollapsedApi } from '../api/projectApi';

import ContextMenu from './ContextMenu';
import ProjectGitMenu from './ProjectGitMenu';
import ProjectGitSection from './ProjectGitSection';
import ProjectGroup from './ProjectGroup';
import type { ProjectItemProps } from './projectItemTypes';
import ProjectSettingsDialog from './ProjectSettingsDialog';
import { useProjectItemMenu } from './useProjectItemMenu';

interface ProjectItemViewExtras {
  /** 当前项目卡是否处于项目列表的最后一个（决定是否�?hairline�?*/
  isLast?: boolean;
}

const ProjectItem: React.FC<ProjectItemProps & ProjectItemViewExtras> = ({
  project,
  isActive,
  isLast,
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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

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

  const openDialog = (type: DialogType, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative mb-0.5 rounded-md overflow-visible',
        isActive && 'active',
        isDragging && 'opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50',
        !isDragging && 'cursor-grab',
      )}
      {...attributes}
      {...listeners}
    >
      <ProjectGroup
        name={project.name}
        avatarColor={project.avatar_color}
        sessionCount={sessionCount}
        expanded={!projectCollapsed}
        isActive={isActive}
        isLast={isLast}
        ideIconSrc={ideIconSrc}
        forceShowActions={gitMenuOpen}
        actions={{
          onToggle: () => {
            toggleCollapsed();
            onSelectProject(project.id);
          },
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
          currentAgent={project.selected_agent}
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

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove Project"
        description={
          <>
            <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
              Are you sure you want to remove{' '}
              <strong className="text-accent-blue">{project.name}</strong>?
            </p>
            <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
              <span className="text-text-muted break-all">{project.path}</span>
            </div>
          </>
        }
        confirmLabel="Remove"
        onConfirm={() => onRemoveProject(project.id)}
        danger
      />
    </div>
  );
};

export default React.memo(ProjectItem);
