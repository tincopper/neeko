import React from 'react';

import { PlusIcon, TrashIcon } from '@/shared/components/icons';

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
 * 轻量 section header — WSL/SSH 外层 distro/server 头：
 * - 行高 22~24px；padding `px-3 pt-3 pb-1`
 * - Label `text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`
 * - distro/server `text-[11px] text-text-secondary`
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

export const SectionHeader: React.FC<SectionHeaderProps> = ({
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
