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
import CliHookHint from '@/features/project/components/CliHookHint';
import ProjectItem from '@/features/project/components/ProjectItem';
import { SectionHeader } from '@/features/project/components/SectionHeader';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
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
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import serverIcon from '../../../assets/server.svg';
import { push, pull, type PushOutcome } from '../../git/api/gitApi';
import { runGitConsoleOp, GIT_BUSY_MESSAGE } from '../../git/api/gitConsoleRun';
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

  /** Convert PushOutcome to error string if AuthRequired. */
  function pushOutcomeMsg(outcome: PushOutcome): string | undefined {
    if ('AuthRequired' in outcome) {
      const { remote_url, ssh, username_hint } = outcome.AuthRequired;
      if (ssh) {
        return 'SSH authentication failed. Ensure ssh-agent is running and key is added via ssh-add.';
      }
      const hint = username_hint ? ` (user: ${username_hint})` : '';
      return `Authentication required for ${remote_url}${hint}. Use the main commit panel or configure git credentials.`;
    }
    return undefined;
  }

  const handlePush = useCallback(
    async (projectId: ProjectId) => {
      const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
      try {
        const worktreePath = activeProjectId === projectId ? activeCheckoutPath : null;
        const result = await runGitConsoleOp({
          header: 'git push',
          projectId,
          projectPath,
          run: (runId) => push(WorkspaceSession.of(projectId, worktreePath), false, runId),
          isAuthRequired: (o) => 'AuthRequired' in o,
        });
        if (result.status === 'busy') {
          showToast?.(GIT_BUSY_MESSAGE, 'error');
          return;
        }
        if (result.status === 'stopped') return; // 用户取消
        const msg = pushOutcomeMsg(result.value);
        if (msg) {
          showToast?.(msg, 'error');
          return;
        }
        onRefreshGit(projectId);
      } catch (e) {
        showToast?.(String(e), 'error');
      }
    },
    [projects, activeProjectId, activeCheckoutPath, onRefreshGit, showToast],
  );

  const handlePull = useCallback(
    async (projectId: ProjectId) => {
      const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
      try {
        const worktreePath = activeProjectId === projectId ? activeCheckoutPath : null;
        const result = await runGitConsoleOp({
          header: 'git pull',
          projectId,
          projectPath,
          run: (runId) => pull(WorkspaceSession.of(projectId, worktreePath), runId),
          isAuthRequired: (o) => 'AuthRequired' in o,
        });
        if (result.status === 'busy') {
          showToast?.(GIT_BUSY_MESSAGE, 'error');
          return;
        }
        if (result.status === 'stopped') return; // 用户取消
        const msg = pushOutcomeMsg(result.value);
        if (msg) {
          showToast?.(msg, 'error');
          return;
        }
        onRefreshGit(projectId);
      } catch (e) {
        showToast?.(String(e), 'error');
      }
    },
    [projects, activeProjectId, activeCheckoutPath, onRefreshGit, showToast],
  );

  return (
    <>
      <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto">
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
        {/* CLI hook 未生效时提示 + 重新安装（会话标题的权威来源就是它）。 */}
        <CliHookHint />
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
