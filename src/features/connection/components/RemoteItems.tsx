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
import React from 'react';

import { PlusIcon, TrashIcon } from '@/shared/components/icons';
import { getDistroIcon } from '@/shared/utils/distros';

import serverIcon from '../../../assets/server.svg';

import ConnectionProjectCard from './ConnectionProjectCard';
import type { WSLItemProps, RemoteItemProps, ConnectionProjectCardProps } from './types';

interface SectionActionButtonProps {
  title: string;
  hoverColor?: string;
  onClick: () => void;
  children: React.ReactNode;
}

const SectionActionButton: React.FC<SectionActionButtonProps> = ({
  title,
  hoverColor,
  onClick,
  children,
}) => (
  <button
    type="button"
    title={title}
    className="text-text-muted p-1 rounded-md hover:bg-white/[0.06] transition shrink-0"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    onMouseOver={(e) => {
      if (hoverColor) (e.currentTarget as HTMLElement).style.color = hoverColor;
    }}
    onMouseOut={(e) => {
      (e.currentTarget as HTMLElement).style.color = '';
    }}
  >
    {children}
  </button>
);

/**
 * 轻量 section header —�?WSL/SSH 外层 distro/server 头：
 * - 行高�?22~24px；padding `px-3 pt-3 pb-1`
 * - Label `text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`
 * - distro/server �?`text-[11px] text-text-secondary`
 * - 计数 `text-[10.5px] text-text-muted`
 * - hover 槽位：Add project / Remove server
 */
interface SectionHeaderProps {
  iconSrc: string;
  iconAlt?: string;
  kindLabel: 'WSL' | 'SSH';
  name: string;
  count: number;
  addTitle: string;
  removeTitle: string;
  onAdd: () => void;
  onRemove: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  iconSrc,
  iconAlt,
  kindLabel,
  name,
  count,
  addTitle,
  removeTitle,
  onAdd,
  onRemove,
}) => (
  <div className="group flex items-center gap-2 px-3 pt-3 pb-1 select-none">
    <img src={iconSrc} className="w-3.5 h-3.5 shrink-0 opacity-80" alt={iconAlt ?? ''} />
    <span className="text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted">
      {kindLabel}
    </span>
    <span className="text-[11px] text-text-secondary truncate">· {name}</span>
    <span className="text-[10.5px] text-text-muted">({count})</span>
    <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <SectionActionButton title={addTitle} onClick={onAdd}>
        <PlusIcon size={12} />
      </SectionActionButton>
      <SectionActionButton title={removeTitle} hoverColor="#f85149" onClick={onRemove}>
        <TrashIcon size={11} />
      </SectionActionButton>
    </div>
  </div>
);

export const WSLItem = React.memo<WSLItemProps>(
  ({
    entry,
    activeKey,
    lastProjectId,
    onSelectProject,
    onRemoveProject,
    onRemoveEntry,
    onAddProject,
    onOpenIde,
    onOpenWorktreeTerminal,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
    onShowToast,
    onDragEnd,
  }) => {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor),
    );

    const handleDndEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id && onDragEnd) {
        onDragEnd(entry.id, String(active.id), String(over.id));
      }
    };

    return (
      <>
        <SectionHeader
          iconSrc={getDistroIcon(entry.distro)}
          iconAlt={entry.distro}
          kindLabel="WSL"
          name={entry.distro}
          count={entry.projects.length}
          addTitle="Add WSL project"
          removeTitle="Remove distro"
          onAdd={() => onAddProject(entry.id)}
          onRemove={() => onRemoveEntry(entry.id)}
        />
        {entry.projects.length === 0 ? (
          <div className="text-[11px] text-text-muted px-3 py-1.5">No projects</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDndEnd}
          >
            <SortableContext
              items={entry.projects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {entry.projects.map((project) => {
                const isActive =
                  activeKey?.distro === entry.distro && activeKey?.projectId === project.id;
                return (
                  <ConnectionProjectCard
                    key={project.id}
                    project={project}
                    entryId={entry.id}
                    source={{ type: 'wsl', distro: entry.distro }}
                    isActive={isActive}
                    isLast={lastProjectId === project.id}
                    onSelectProject={
                      onSelectProject as ConnectionProjectCardProps['onSelectProject']
                    }
                    onRemoveProject={onRemoveProject}
                    onOpenIde={onOpenIde}
                    onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                    ideCommandOverrides={ideCommandOverrides}
                    onOpenSettings={onOpenSettings}
                    onRefresh={onRefresh ? () => onRefresh(entry.distro, project.id) : undefined}
                    agents={agents}
                    config={config}
                    onSaveProjectSettings={onSaveProjectSettings}
                    onShowToast={onShowToast}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </>
    );
  },
);

WSLItem.displayName = 'WSLItem';

export const RemoteItem = React.memo<RemoteItemProps>(
  ({
    entry,
    activeKey,
    lastProjectId,
    onSelectProject,
    onRemoveProject,
    onRemoveEntry,
    onAddProject,
    onOpenIde,
    onOpenWorktreeTerminal,
    invokeRemoteGit,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
    onShowToast,
    onDragEnd,
  }) => {
    const label = `${entry.host}:${entry.port}`;

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor),
    );

    if (!invokeRemoteGit) return null;

    const handleDndEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id && onDragEnd) {
        onDragEnd(entry.id, String(active.id), String(over.id));
      }
    };

    return (
      <>
        <SectionHeader
          iconSrc={serverIcon}
          iconAlt="server"
          kindLabel="SSH"
          name={label}
          count={entry.projects.length}
          addTitle="Add Remote project"
          removeTitle="Remove server"
          onAdd={() => onAddProject(entry.id)}
          onRemove={() => onRemoveEntry(entry.id)}
        />
        {entry.projects.length === 0 ? (
          <div className="text-[11px] text-text-muted px-3 py-1.5">No projects</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDndEnd}
          >
            <SortableContext
              items={entry.projects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {entry.projects.map((project) => {
                const isActive =
                  activeKey?.host === entry.host && activeKey?.projectId === project.id;
                return (
                  <ConnectionProjectCard
                    key={project.id}
                    project={project}
                    entryId={entry.id}
                    source={{
                      type: 'remote',
                      entryId: entry.id,
                      host: entry.host,
                      invokeRemoteGit: invokeRemoteGit,
                    }}
                    isActive={isActive}
                    isLast={lastProjectId === project.id}
                    onSelectProject={
                      onSelectProject as ConnectionProjectCardProps['onSelectProject']
                    }
                    onRemoveProject={onRemoveProject}
                    onOpenIde={onOpenIde}
                    onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                    ideCommandOverrides={ideCommandOverrides}
                    onOpenSettings={onOpenSettings}
                    onRefresh={onRefresh ? () => onRefresh(entry.id, project.id) : undefined}
                    agents={agents}
                    config={config}
                    onSaveProjectSettings={onSaveProjectSettings}
                    onShowToast={onShowToast}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </>
    );
  },
);

RemoteItem.displayName = 'RemoteItem';
