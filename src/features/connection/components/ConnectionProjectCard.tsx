import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useCallback, useMemo, useState } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- connection project card uses project group/session row components
import { ProjectGroup, SessionRow } from '@/features/project/components';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import ProjectSettingsDialog from '@/shared/components/ProjectSettingsDialog';
import { useGitStore } from '@/shared/store/gitStore';
import { selectEntries, useProjectStore } from '@/shared/store/projectStore';
import { selectActiveWorktreePath, useWorktreeStore } from '@/shared/store/worktreeStore';
import { getIdeIconByCommand } from '@/shared/utils/idePresets';
import { repoKeyOf } from '@/shared/utils/repoRef';

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
    isLast,
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
    const activeWorktreePath = useWorktreeStore((s) => selectActiveWorktreePath(s, project.id));

    // ahead/behind 仅在 active 项目时显示；键 = 该项目的**激活单元**（与写入侧同一把键）。
    // 旧键带 `{source}:{identifier}` 前缀，而那三个写入点的 identifier 约定各不相同 ⇒ 读不到。
    const unitRepoKey = repoKeyOf(project.id, activeWorktreePath);
    const aheadBehind = useGitStore((s) => s.aheadBehind[unitRepoKey]);

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
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
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

    // local 主终端行的 +A -D = **主仓单元**的 status 条目（worktree 单元各有自己的条目）。
    // 缺失 = 未知（未挂载 / 刚被切走）→ 不显示 chip；绝不沿用其它单元的条目。
    const mainEntries = useProjectStore((s) => selectEntries(s, repoKeyOf(project.id, null)));

    const localChanges = useMemo(() => {
      const files = mainEntries ?? [];
      if (files.length === 0) return undefined;
      const add = files.reduce((s, f) => s + f.additions, 0);
      const del = files.reduce((s, f) => s + f.deletions, 0);
      if (add === 0 && del === 0) return undefined;
      return { add, del };
    }, [mainEntries]);

    const localActive = isActive && !activeWorktreePath;

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
          expanded={!collapsed}
          isActive={isActive}
          isLast={isLast}
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
              changes={localChanges}
              title="Open primary terminal"
              onClick={(e) => {
                e.stopPropagation();
                onSelectProject(project.id);
              }}
            />
            <ConnectionWorktreeList
              worktrees={worktrees}
              activeWorktreePath={isActive ? activeWorktreePath : null}
              onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
              onCommitRenameWorktree={worktreeActions.rename}
              onRemoveWorktree={worktreeActions.remove}
              onGetWorktreeChangedFiles={worktreeActions.getChangedFiles}
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
          onConfirm={() => {
            setConfirmRemove(false);
            onRemoveProject(entryId, project.id);
          }}
          danger
        />
      </div>
    );
  },
);

ConnectionProjectCard.displayName = 'ConnectionProjectCard';

export default ConnectionProjectCard;
