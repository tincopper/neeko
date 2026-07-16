import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useCallback, useState, useEffect, useMemo } from 'react';

import ConnectionProjectCard from '@/features/connection/components/ConnectionProjectCard';
import { useRemoteContext } from '@/features/connection/contexts/RemoteContext';
import { useWslContext } from '@/features/connection/contexts/WslContext';
import { SectionHeader } from '@/features/connection/components/RemoteItems';
import { getDistroIcon } from '@/shared/utils/distros';
import CommitDialog from '@/features/git/components/CommitDialog';
import GitDialog, { DialogState } from '@/features/git/components/GitDialog';
import { useAheadBehindSync } from '@/features/git/hooks/useAheadBehindSync';
import ProjectItem from '@/features/project/components/ProjectItem';
import { useProjectActionsContext } from '@/features/project/context';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
import { useProjectStore } from '@/features/project/store';
import { useAppContext } from '@/shared/contexts/AppContext';
import serverIcon from '../../../assets/server.svg';
import { withTimeout } from '@/shared/utils/withTimeout';

import { push, pull, type PushOutcome } from '../../git/api/gitApi';

const ProjectsPanel: React.FC = () => {
  const { config, agents, ideCommandOverrides, showToast } = useAppContext();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const {
    onRemoveProject,
    onSelectProject,
    onSelectFile,
    onRefreshGit,
    onBackToMainTerminal,
    onOpenIde,
    onOpenWorktreeTerminal,
    onSelectWorktreeFile,
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
  const [remoteHomeDir, setRemoteHomeDir] = useState<string>('');

  const { commands } = useActiveProject();

  useAheadBehindSync(commands);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const isEmpty = projects.length === 0;

  // Derived: WSL projects grouped by distro, Remote projects grouped by host
  const { localProjects, wslGroups, remoteGroups, lastGroup, lastProjectId } = useMemo(() => {
    const local: typeof projects = [];
    const wslMap = new Map<string, typeof projects>();
    const remoteMap = new Map<string, { entry: (typeof remoteEntries)[number]; projects: typeof projects }>();

    for (const p of projects) {
      const env = p.environment;
      if (env.type === 'Wsl') {
        const group = wslMap.get(env.distro) ?? [];
        group.push(p);
        wslMap.set(env.distro, group);
      } else if (env.type === 'Remote') {
        const entry = remoteEntries.find(e => e.host === env.host);
        if (entry) {
          const existing = remoteMap.get(entry.id) ?? { entry, projects: [] };
          existing.projects.push(p);
          remoteMap.set(entry.id, existing);
        }
        local.push(p);
      } else {
        local.push(p);
      }
    }

    const wslGroups = Array.from(wslMap.entries()).map(([distro, projects]) => ({ distro, projects }));
    const remoteGroups = Array.from(remoteMap.values());

    // Determine which group has the last project across all sections
    let lastGroup: 'local' | 'wsl' | 'remote' | null = null;
    let lastProjectId: string | null = null;
    if (local.length > 0) { lastGroup = 'local'; lastProjectId = local[local.length - 1].id; }
    for (const g of wslGroups) {
      if (g.projects.length > 0) { lastGroup = 'wsl'; lastProjectId = g.projects[g.projects.length - 1].id; }
    }
    for (const g of remoteGroups) {
      if (g.projects.length > 0) { lastGroup = 'remote'; lastProjectId = g.projects[g.projects.length - 1].id; }
    }

    return { localProjects: local, wslGroups, remoteGroups, lastGroup, lastProjectId };
  }, [projects, remoteEntries]);

  useEffect(() => {
    if (!dialog || dialog.type !== 'new-worktree' || dialog.source?.type !== 'remote' || !dialog.source.entryId) {
      setRemoteHomeDir('');
      return;
    }
    if (invokeRemoteGit) {
      invokeRemoteGit('get_remote_home_dir', dialog.source.entryId, {})
        .then((dir) => setRemoteHomeDir(dir as string))
        .catch(() => setRemoteHomeDir(''));
    }
  }, [dialog, invokeRemoteGit]);

  const handleCommit = useCallback((projectId: string) => {
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
    async (projectId: string) => {
      try {
        const outcome = await withTimeout(push(projectId, false), 30_000, 'push');
        const msg = pushOutcomeMsg(outcome);
        if (msg) { showToast?.(msg, 'error'); return; }
        onRefreshGit(projectId);
      } catch (e) {
        showToast?.(String(e), 'error');
      }
    },
    [onRefreshGit, showToast],
  );

  const handlePull = useCallback(
    async (projectId: string) => {
      try {
        const outcome = await withTimeout(pull(projectId), 30_000, 'pull');
        const msg = pushOutcomeMsg(outcome);
        if (msg) { showToast?.(msg, 'error'); return; }
        onRefreshGit(projectId);
      } catch (e) {
        showToast?.(String(e), 'error');
      }
    },
    [onRefreshGit, showToast],
  );

  return (
    <>
      <div className="flex flex-col flex-1">
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
                  const isLast = lastGroup === 'local' && lastProjectId === project.id;
                  return (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      isActive={activeProjectId === project.id}
                      isLast={isLast}
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
                        onSelectWorktreeFile,
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
                        const entry = wslEntries.find(e => e.distro === distro);
                        if (entry) onRemoveWslEntry(entry.id);
                      }}
                    />
                    {wslProjs.map((project) => {
                      const isLast = lastGroup === 'wsl' && lastProjectId === project.id;
                      return (
                        <ConnectionProjectCard
                          key={project.id}
                          project={project}
                          entryId={distro}
                          source={{ type: 'wsl', distro }}
                          isActive={activeProjectId === project.id}
                          isLast={isLast}
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
                      const isLast = lastGroup === 'remote' && lastProjectId === project.id;
                      return (
                        <ConnectionProjectCard
                          key={project.id}
                          project={project}
                          entryId={entry.id}
                          source={{ type: 'remote', entryId: entry.id, host: entry.host }}
                          isActive={activeProjectId === project.id}
                          isLast={isLast}
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
                              ? (agentId, ideCmd) => onSaveProjectSettings(project.id, agentId, ideCmd)
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
          projectId={commitProjectId}
          onClose={() => setCommitProjectId(null)}
          onRefreshGit={onRefreshGit}
        />
      )}
    </>
  );
};

export default React.memo(ProjectsPanel);
