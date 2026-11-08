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
    className="text-text-muted p-1 rounded-md hover:bg-bg-hover transition shrink-0"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    onFocus={(e) => {
      if (hoverColor) (e.currentTarget as HTMLElement).style.color = hoverColor;
    }}
    onBlur={(e) => {
      (e.currentTarget as HTMLElement).style.color = '';
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
 * 轻量 section header — WSL/SSH 外层 distro/server 头（方案 C 轻量化）：
 * - 行高 ~24px；padding `px-2 pt-2 pb-1`
 * - 名称前置 `text-[0.9em] font-medium text-text-secondary`，环境类别作弱后缀 `· WSL/SSH`
 * - 计数 `text-[0.82em] font-mono text-text-muted`
 * - hover 槽位：Add project / Remove server（岛屿之间的分组行，自身不铺底）
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
  <div className="group flex items-center gap-1.5 px-2 pt-2 pb-1 select-none">
    <img src={iconSrc} className="w-3 h-3 shrink-0 opacity-80" alt={iconAlt ?? ''} />
    <span className="text-[0.9em] font-medium text-text-secondary truncate">{name}</span>
    <span className="shrink-0 text-[0.82em] text-text-muted">· {kindLabel}</span>
    <span className="shrink-0 font-mono text-[0.82em] text-text-muted">{count}</span>
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
