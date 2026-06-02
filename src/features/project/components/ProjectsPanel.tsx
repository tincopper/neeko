import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useCallback, useState, useEffect, useMemo } from 'react';

import { WSLItem, RemoteItem } from '@/features/connection/components/RemoteItems';
import { useRemoteContext } from '@/features/connection/contexts/RemoteContext';
import { useWslContext } from '@/features/connection/contexts/WslContext';
import CommitDialog from '@/features/git/components/CommitDialog';
import GitDialog, { DialogState } from '@/features/git/components/GitDialog';
import { useAheadBehindSync } from '@/features/git/hooks/useAheadBehindSync';
import ProjectItem from '@/features/project/components/ProjectItem';
import { useProjectActionsContext } from '@/features/project/context';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
import { useProjectList } from '@/features/project/hooks/useProjectList';
import { useProjectStore } from '@/features/project/store';
import { useAppContext } from '@/shared/contexts/AppContext';
import { IS_WINDOWS } from '@/shared/utils/platform';

import { push, pull } from '../../git/api/gitApi';

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
    activeWslKey,
    onSelectWslProject,
    onRemoveWslProject,
    onRemoveWslEntry,
    onAddWslProject,
    onRefreshWslGit,
    onOpenWslIde,
    onOpenWslWorktreeTerminal,
    onWslDragEnd,
  } = useWslContext();
  const {
    remoteEntries,
    activeRemoteKey,
    onSelectRemoteProject,
    onRemoveRemoteProject,
    onRemoveRemoteEntry,
    onAddRemoteProject,
    onRefreshRemoteGit,
    onOpenRemoteIde,
    onOpenRemoteWorktreeTerminal,
    invokeRemoteGit,
    onRemoteDragEnd,
  } = useRemoteContext();

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [commitProjectId, setCommitProjectId] = useState<string | null>(null);
  const [remoteHomeDir, setRemoteHomeDir] = useState<string>('');

  const { items: unifiedItems, isEmpty: isEmpty } = useProjectList();
  const { commands } = useActiveProject();

  useAheadBehindSync(commands);

  /// The very last item across all three sections
  const lastCardId = useMemo<{
    kind: 'local' | 'wsl' | 'remote';
    entryId?: string;
    projectId: string;
  } | null>(() => {
    if (unifiedItems.length === 0) return null;
    const last = unifiedItems[unifiedItems.length - 1];
    return { kind: last.kind, entryId: last.entryId, projectId: last.id };
  }, [unifiedItems]);

  useEffect(() => {
    if (
      !dialog ||
      dialog.type !== 'new-worktree' ||
      dialog.source?.type !== 'remote' ||
      !dialog.source.entryId ||
      !invokeRemoteGit
    ) {
      setRemoteHomeDir('');
      return;
    }
    invokeRemoteGit('get_remote_home_dir', dialog.source.entryId, {})
      .then((dir) => setRemoteHomeDir(dir as string))
      .catch(() => setRemoteHomeDir(''));
  }, [dialog, invokeRemoteGit]);

  const handleCommit = useCallback((projectId: string) => {
    setCommitProjectId(projectId);
  }, []);

  const handlePush = useCallback(
    async (projectId: string) => {
      try {
        const projectPath =
          useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
        await push({ Local: { project_path: projectPath } }, false);
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
        const projectPath =
          useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
        await pull({ Local: { project_path: projectPath } });
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
                {projects.map((project) => {
                  const isLast =
                    lastCardId?.kind === 'local' && lastCardId.projectId === project.id;
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
              </SortableContext>
            </DndContext>

            {IS_WINDOWS &&
              wslEntries.map((entry) => (
                <WSLItem
                  key={entry.id}
                  entry={entry}
                  activeKey={activeWslKey}
                  lastProjectId={
                    lastCardId?.kind === 'wsl' && lastCardId.entryId === entry.id
                      ? lastCardId.projectId
                      : null
                  }
                  onSelectProject={onSelectWslProject}
                  onRemoveProject={onRemoveWslProject}
                  onRemoveEntry={onRemoveWslEntry}
                  onAddProject={onAddWslProject}
                  onOpenIde={onOpenWslIde}
                  onOpenWorktreeTerminal={onOpenWslWorktreeTerminal}
                  ideCommandOverrides={ideCommandOverrides}
                  onRefresh={
                    onRefreshWslGit
                      ? (distro, projectId) => {
                          const e = wslEntries.find((en) => en.distro === distro);
                          const p = e?.projects.find((pr) => pr.id === projectId);
                          if (p) onRefreshWslGit(distro, p.id, p.path);
                        }
                      : undefined
                  }
                  agents={agents}
                  config={config}
                  onSaveProjectSettings={
                    onSaveProjectSettings
                      ? (agentId, ideCmd) => {
                          const e = wslEntries.find((en) => en.distro === activeWslKey?.distro);
                          const p = e?.projects.find((pr) => pr.id === activeWslKey?.projectId);
                          if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                        }
                      : undefined
                  }
                  onShowToast={showToast}
                  onDragEnd={onWslDragEnd}
                />
              ))}

            {remoteEntries.map((entry) => (
              <RemoteItem
                key={entry.id}
                entry={entry}
                activeKey={activeRemoteKey}
                lastProjectId={
                  lastCardId?.kind === 'remote' && lastCardId.entryId === entry.id
                    ? lastCardId.projectId
                    : null
                }
                onSelectProject={onSelectRemoteProject}
                onRemoveProject={onRemoveRemoteProject}
                onRemoveEntry={onRemoveRemoteEntry}
                onAddProject={onAddRemoteProject}
                onOpenIde={onOpenRemoteIde}
                onOpenWorktreeTerminal={onOpenRemoteWorktreeTerminal}
                invokeRemoteGit={invokeRemoteGit}
                ideCommandOverrides={ideCommandOverrides}
                onRefresh={
                  onRefreshRemoteGit
                    ? (entryId, projectId) => {
                        const e = remoteEntries.find((en) => en.id === entryId);
                        const p = e?.projects.find((pr) => pr.id === projectId);
                        if (p) onRefreshRemoteGit(entryId, p.id, p.path);
                      }
                    : undefined
                }
                agents={agents}
                config={config}
                onSaveProjectSettings={
                  onSaveProjectSettings
                    ? (agentId, ideCmd) => {
                        const e = remoteEntries.find((en) => en.id === activeRemoteKey?.host);
                        const p = e?.projects.find((pr) => pr.id === activeRemoteKey?.projectId);
                        if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                      }
                    : undefined
                }
                onShowToast={showToast}
                onDragEnd={onRemoteDragEnd}
              />
            ))}
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
