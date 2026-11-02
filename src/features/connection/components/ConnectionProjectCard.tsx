import { useSortable } from '@dnd-kit/sortable';
import React, { useCallback, useMemo, useState } from 'react';

import { UnitSessionList } from '@/features/live-sessions';
import { cn } from '@/lib/utils';
import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import DeleteConfirmDialog from '@/shared/components/DeleteConfirmDialog';
import ProjectGroup from '@/shared/components/ProjectGroup';
import ProjectSettingsDialog from '@/shared/components/ProjectSettingsDialog';
import SessionRow from '@/shared/components/SessionRow';
import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { useUnitsWithActiveSession } from '@/shared/hooks/useUnitsWithActiveSession';
import { NO_SESSIONS, dominantState } from '@/shared/selectors/liveSessionSelectors';
import { useGitStore } from '@/shared/store/gitStore';
import {
  selectActiveCheckoutPath,
  useActiveWorkspaceKey,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import { getIdeIconByCommand } from '@/shared/utils/idePresets';
import { sortableCardStyle } from '@/shared/utils/sortableCardStyle';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useConnectionWorktreeActions } from '../hooks/useConnectionWorktreeActions';

import ConnectionWorktreeList from './ConnectionWorktreeList';
import type { ConnectionProjectCardProps } from './types';

const LOG_TAG: Record<string, string> = {
  wsl: '[WSL]',
  remote: '[SSH]',
};

const ConnectionProjectCard: React.FC<ConnectionProjectCardProps> = React.memo(
  ({
    project,
    entryId,
    source,
    isActive,
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
  }) => {
    const isWsl = source.type === 'wsl';
    const identifier = isWsl ? source.distro : source.entryId;
    const logTag = LOG_TAG[source.type] ?? '';
    const connectionId = identifier;

    // 本卡片渲染的是 project.id 的行 → 单元归属按该 projectId 取（不是「当前激活项目」的镜像）
    const activeCheckoutPath = useWorkspaceStore((s) => selectActiveCheckoutPath(s, project.id));

    // 侧栏两个投影（单元角标 / 会话子列表）的同一份分组结果。
    const sessionsByUnit = useSessionsByUnit();

    // ahead/behind 仅在 active 项目时显示；键 = 该项目的**激活单元**（与写入侧同一把键）。
    // 旧键带 `{source}:{identifier}` 前缀，而那三个写入点的 identifier 约定各不相同 ⇒ 读不到。
    const workspaceKey = useActiveWorkspaceKey(project.id);
    const aheadBehind = useGitStore((s) => (workspaceKey ? s.aheadBehind[workspaceKey] : null));

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
    const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
      useSortable({
        id: project.id,
      });

    const handleOpenWorktreeTerminal = useCallback(
      (wtPath: string, branch: string) => {
        onOpenWorktreeTerminal?.(connectionId, wtPath, branch);
      },
      [onOpenWorktreeTerminal, connectionId],
    );

    // worktree 行的命令面（改名 / 删除 / 取变更 / 脏检查）收拢在本 feature 的 hook 里
    const worktreeActions = useConnectionWorktreeActions(project.id, logTag);

    const handleRemove = useCallback(() => {
      setConfirmRemove(true);
    }, []);

    const handleOpenIde = useMemo(
      () =>
        onOpenIde && project.selected_ide
          ? () => onOpenIde(connectionId, project.path, project.selected_ide ?? '')
          : undefined,
      [onOpenIde, connectionId, project.path, project.selected_ide],
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
          label: 'Open in IDE',
          shortcut: 'Ctrl+O',
          action: () => handleOpenIde(),
        });
      }

      if (onRefresh) {
        items.push({
          label: 'Refresh Terminal',
          shortcut: 'Ctrl+Alt+R',
          action: () => onRefresh(),
        });
      }

      items.push({ separator: true });

      if (onOpenSettings && config) {
        items.push({
          label: 'Project Settings',
          action: () => setSettingsOpen(true),
        });
      }

      items.push({
        label: 'Remove Project',
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

    // local 主终端行只展示 ↑N（待 push 提交数），取自**主仓单元**的键。
    // 注：曾有 +A -D 聚合，数据源（`FileChange.additions/deletions`）在 G4 后恒为 0，已删除。
    const localActive = isActive && !activeCheckoutPath;

    // 主仓单元的角标与子列表（与本地侧栏同一份快照、同一把 key）。
    const mainUnitKey = WorkspaceSession.of(project.id, null).key;
    const mainUnitSessions = sessionsByUnit.get(mainUnitKey) ?? NO_SESSIONS;
    const childActive = useUnitsWithActiveSession().has(mainUnitKey);

    const style = sortableCardStyle({ isDragging, transition, transform });

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
      >
        <ProjectGroup
          dragHandleRef={setActivatorNodeRef}
          dragHandleProps={listeners}
          name={project.name}
          avatarColor={project.avatar_color}
          sessionCount={sessionCount}
          expanded={!collapsed}
          isActive={isActive}
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
              title="Open primary terminal"
              status={dominantState(mainUnitSessions)}
              childCount={mainUnitSessions.length}
              childActive={childActive}
              onClick={(e) => {
                e.stopPropagation();
                onSelectProject(project.id);
              }}
            >
              {mainUnitSessions.length > 0 ? (
                <UnitSessionList
                  workspaceKey={mainUnitKey}
                  onRevealUnit={() => onSelectProject(project.id)}
                />
              ) : undefined}
            </SessionRow>
            <ConnectionWorktreeList
              projectId={project.id}
              worktrees={worktrees}
              activeCheckoutPath={isActive ? activeCheckoutPath : null}
              onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
              onCommitRenameWorktree={worktreeActions.rename}
              onRemoveWorktree={worktreeActions.remove}
              onIsWorktreeDirty={worktreeActions.checkDirty}
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
            currentAgent={project.selected_agents?.[0] ?? null}
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

        <DeleteConfirmDialog
          pending={confirmRemove ? project : null}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={(p) => onRemoveProject(entryId, p.id)}
          title="Remove Project"
          confirmLabel="Remove"
          describe={(p) => (
            <>
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                Are you sure you want to remove{' '}
                <strong className="text-accent-blue">{p.name}</strong>?
              </p>
              <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
                <span className="text-text-muted break-all">{p.path}</span>
              </div>
            </>
          )}
        />
      </div>
    );
  },
);

ConnectionProjectCard.displayName = 'ConnectionProjectCard';

export default ConnectionProjectCard;
