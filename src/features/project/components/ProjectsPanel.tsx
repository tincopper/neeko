import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useCallback, useState, useEffect, useMemo } from 'react';

import { ConnectionProjectCard } from '@/features/connection';
import { CommitDialog } from '@/features/git';
import ProjectItem from '@/features/project/components/ProjectItem';
import { SectionHeader } from '@/features/project/components/SectionHeader';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
import { useGitConsoleActions } from '@/features/project/hooks/useGitConsoleActions';
import { useProjectActionsContext } from '@/features/project/ProjectContext';
import GitDialog, { DialogState } from '@/shared/components/GitDialog';
import { useAppContext } from '@/shared/contexts/AppContext';
import { useRemoteContext } from '@/shared/contexts/RemoteContext';
import { useWslContext } from '@/shared/contexts/WslContext';
import { useAheadBehindSync } from '@/shared/hooks/useAheadBehindSync';
import { useScrollMemory } from '@/shared/hooks/useScrollMemory';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveCheckoutPath } from '@/shared/store/workspaceStore';
import { getDistroIcon } from '@/shared/utils/distros';
import { buildScrollKey } from '@/shared/utils/scrollMemory';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import serverIcon from '../../../assets/server.svg';
import { groupProjects } from '../utils/groupProjects';

/** 滚动视图身份：全局唯一 surface 常量（新增面板只在此处加值）。 */
const SCROLL_SURFACE = 'dock.projects';

const ProjectsPanel: React.FC = () => {
  const { config, agents, ideCommandOverrides, showToast } = useAppContext();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeCheckoutPath = useActiveCheckoutPath();
  const {
    onRemoveProject,
    onSelectProject,
    onSelectFile,
    onRefreshGit,
    onBackToMainTerminal,
    onOpenIde,
    onOpenWorktreeTerminal,
    onSaveProjectSettings,
    onDragEnd,
  } = useProjectActionsContext();
  const {
    wslEntries,
    onRemoveWslProject,
    onRemoveWslEntry,
    onAddWslProject,
    onRefreshWslGit,
    onOpenWslIde,
    onOpenWslWorktreeTerminal,
  } = useWslContext();
  const {
    remoteEntries,
    onRemoveRemoteProject,
    onRemoveRemoteEntry,
    onAddRemoteProject,
    onRefreshRemoteGit,
    onOpenRemoteIde,
    onOpenRemoteWorktreeTerminal,
    invokeRemoteGit,
  } = useRemoteContext();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [commitProjectId, setCommitProjectId] = useState<string | null>(null);
  // 滚动记忆：Dock 面板互切（保活期引擎丢位置）与卸载重建都恢复列表位置。
  //
  // 滚动条**整条隐藏**（见容器 class 里的 `scrollbar-hidden`），因此不需要占位补偿：
  // 经典滚动条是「占布局宽度、只占右侧」，本容器的内缩却由行自己用 `px-3` / `mx-1.5`
  // 表达 —— 留着滚动条就会量出 0/13（项目头）与 6/19（会话行）这种左右不等。
  // 补偿（`useScrollbarCompensation`）只适用于**要留滚动条**的面板；这里二选一，
  // 选定的是「不要滚动条，但要滚动」——滚轮 / 触控板 / 键盘 / scrollIntoView 全不受影响。
  const scrollRef = useScrollMemory<HTMLDivElement>(buildScrollKey(SCROLL_SURFACE));
  const [remoteHomeDir, setRemoteHomeDir] = useState<string>('');

  const { commands } = useActiveProject();

  useAheadBehindSync(commands);

  // 只有指针拖拽：项目头的键盘约定是 Enter/Space 折叠（`ProjectGroup`），
  // 而 `KeyboardSensor` 的激活键恰好也是 Space/Enter —— 两套叠在同一节点上就说不清
  // 「空格到底该折叠还是开始拖动」。所以把手只接指针监听器，键盘拖拽不声明
  // （`ProjectGroup` 的 `dragHandleProps` 因此也只收 `DraggableSyntheticListeners`）。
  // 声明了却不被消费的传感器 = 死配置，这一行以前就是那个形态。
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const isEmpty = projects.length === 0;

  // Derived: WSL projects grouped by distro, Remote projects grouped by host
  const { localProjects, wslGroups, remoteGroups } = useMemo(
    () => groupProjects(projects, remoteEntries),
    [projects, remoteEntries],
  );

  // Derive active dialog key; reset remoteHomeDir during render when dialog becomes inactive
  const dialogRemoteEntryId =
    dialog?.type === 'new-worktree' && dialog.source?.type === 'remote'
      ? (dialog.source.entryId ?? null)
      : null;
  // Reset remoteHomeDir when dialog becomes inactive
  useEffect(() => {
    if (!dialogRemoteEntryId) {
      // Defer to avoid sync setState in effect
      Promise.resolve().then(() => setRemoteHomeDir(''));
    }
  }, [dialogRemoteEntryId]);

  useEffect(() => {
    if (!dialogRemoteEntryId) return;
    if (invokeRemoteGit) {
      invokeRemoteGit('get_remote_home_dir', dialogRemoteEntryId, {})
        .then((dir) => setRemoteHomeDir(dir as string))
        .catch(() => setRemoteHomeDir(''));
    }
  }, [dialogRemoteEntryId, invokeRemoteGit]);

  const handleCommit = useCallback((projectId: ProjectId) => {
    setCommitProjectId(projectId);
  }, []);

  // push / pull 的编排（路径解析 / Console / busy / 取消 / 认证 / 刷新）在 hook 里只有一份：
  // 两个入口逐行相同的代码留在面板里时，最典型的漂移是「只给 push 加了刷新」。
  const { handlePush, handlePull } = useGitConsoleActions({
    projects,
    activeProjectId,
    activeCheckoutPath,
    onRefreshGit,
    showToast,
  });

  return (
    <>
      <div
        ref={scrollRef}
        className="flex flex-col h-full overflow-y-auto scrollbar-hidden"
        data-testid="projects-scroll"
      >
        {isEmpty ? (
          <div className="no-projects p-5 text-center text-text-muted text-[0.86em]">
            No projects added
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (over && active.id !== over.id) {
                  onDragEnd?.(String(active.id), String(over.id));
                }
              }}
            >
              <SortableContext
                items={projects.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {localProjects.map((project) => {
                  return (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      isActive={activeProjectId === project.id}
                      actions={{
                        onSelectProject,
                        onRemoveProject,
                        onSelectFile,
                        onRefreshGit,
                        onBackToMainTerminal,
                        onOpenDialog: setDialog,
                        onCommit: handleCommit,
                        onPush: handlePush,
                        onPull: handlePull,
                        onOpenIde,
                        onOpenWorktreeTerminal,
                        onRefresh: onRefreshGit,
                        onSaveProjectSettings,
                        onShowToast: showToast,
                      }}
                      viewConfig={{
                        ideCommandOverrides,
                        agents,
                        config,
                      }}
                    />
                  );
                })}

                {wslGroups.map(({ distro, projects: wslProjs }) => (
                  <React.Fragment key={distro}>
                    <SectionHeader
                      iconSrc={getDistroIcon(distro)}
                      iconAlt={distro}
                      kindLabel="WSL"
                      name={distro}
                      count={wslProjs.length}
                      addTitle="Add WSL project"
                      removeTitle="Remove distro"
                      onAdd={() => onAddWslProject(distro)}
                      onRemove={() => {
                        const entry = wslEntries.find((e) => e.distro === distro);
                        if (entry) onRemoveWslEntry(entry.id);
                      }}
                    />
                    {wslProjs.map((project) => {
                      return (
                        <ConnectionProjectCard
                          key={project.id}
                          project={project}
                          entryId={distro}
                          source={{ type: 'wsl', distro }}
                          isActive={activeProjectId === project.id}
                          onSelectProject={onSelectProject}
                          onRemoveProject={onRemoveWslProject}
                          onOpenIde={onOpenWslIde}
                          onOpenWorktreeTerminal={onOpenWslWorktreeTerminal}
                          ideCommandOverrides={ideCommandOverrides}
                          onRefresh={
                            onRefreshWslGit
                              ? () => onRefreshWslGit(distro, project.id, project.path)
                              : undefined
                          }
                          agents={agents}
                          config={config}
                          onSaveProjectSettings={
                            onSaveProjectSettings
                              ? (a, i) => onSaveProjectSettings!(project.id, a, i)
                              : undefined
                          }
                          onShowToast={showToast}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}

                {remoteGroups.map(({ entry, projects: remoteProjs }) => (
                  <React.Fragment key={entry.id}>
                    <SectionHeader
                      iconSrc={serverIcon}
                      iconAlt="server"
                      kindLabel="SSH"
                      name={`${entry.host}:${entry.port}`}
                      count={remoteProjs.length}
                      addTitle="Add Remote project"
                      removeTitle="Remove server"
                      onAdd={() => onAddRemoteProject(entry.id)}
                      onRemove={() => onRemoveRemoteEntry(entry.id)}
                    />
                    {remoteProjs.map((project) => {
                      return (
                        <ConnectionProjectCard
                          key={project.id}
                          project={project}
                          entryId={entry.id}
                          source={{ type: 'remote', entryId: entry.id, host: entry.host }}
                          isActive={activeProjectId === project.id}
                          onSelectProject={onSelectProject}
                          onRemoveProject={onRemoveRemoteProject}
                          onOpenIde={onOpenRemoteIde}
                          onOpenWorktreeTerminal={onOpenRemoteWorktreeTerminal}
                          ideCommandOverrides={ideCommandOverrides}
                          onRefresh={
                            onRefreshRemoteGit
                              ? () => onRefreshRemoteGit(entry.id, project.id, project.path)
                              : undefined
                          }
                          agents={agents}
                          config={config}
                          onSaveProjectSettings={
                            onSaveProjectSettings
                              ? (agentId, ideCmd) =>
                                  onSaveProjectSettings(project.id, agentId, ideCmd)
                              : undefined
                          }
                          onShowToast={showToast}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      {dialog && (
        <GitDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onRefreshGit={onRefreshGit}
          remoteHomeDir={remoteHomeDir}
          onRefreshAfterWslSsh={
            dialog.source
              ? () => {
                  const src = dialog.source;
                  if (!src) return;
                  if (src.type === 'wsl' && src.distro && onRefreshWslGit) {
                    const entry = wslEntries.find((e) => e.distro === src.distro);
                    const project = entry?.projects.find((p) => p.path === src.projectPath);
                    if (entry && project) {
                      onRefreshWslGit(src.distro, project.id, src.projectPath);
                    }
                  } else if (src.type === 'remote' && src.entryId && onRefreshRemoteGit) {
                    const entry = remoteEntries.find((e) => e.id === src.entryId);
                    const project = entry?.projects.find((p) => p.path === src.projectPath);
                    if (entry && project) {
                      onRefreshRemoteGit(src.entryId, project.id, src.projectPath);
                    }
                  }
                }
              : undefined
          }
        />
      )}
      {commitProjectId && (
        <CommitDialog
          projectId={commitProjectId as ProjectId}
          onClose={() => setCommitProjectId(null)}
          onRefreshGit={onRefreshGit}
        />
      )}
    </>
  );
};

export default React.memo(ProjectsPanel);
