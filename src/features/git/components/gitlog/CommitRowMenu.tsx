import type { ReactNode, RefObject } from 'react';

import { cn } from '@/lib/utils';
import {
  GitBranchPlus,
  GitFork,
  SquareArrowOutUpRight,
  Tag,
  Undo2,
} from '@/shared/components/icons';

import { ROW_HEIGHT } from './virtualScroll';

/** 菜单锚点：行高下方（常量样式） */
const MENU_TOP_STYLE = { top: ROW_HEIGHT };

const MENU_ITEMS: { icon: ReactNode; label: string }[] = [
  { icon: <GitFork size={11} />, label: 'Cherry Pick' },
  { icon: <Undo2 size={11} />, label: 'Revert' },
  { icon: <GitBranchPlus size={11} />, label: 'Create Branch' },
  { icon: <Tag size={11} />, label: 'Create Tag' },
  { icon: <SquareArrowOutUpRight size={11} />, label: 'Checkout Detached' },
];

function MenuItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className={cn(
        'flex items-center gap-1.5 w-full px-2 py-1 text-[var(--font-size)] transition-colors duration-100',
        'text-text-muted/60 cursor-not-allowed',
      )}
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      {label}
    </button>
  );
}

/** 行右键菜单（当前全部 disabled + Coming soon）。menuRef 由 useCommitMenu 提供。 */
export function CommitRowMenu({ menuRef }: { menuRef: RefObject<HTMLDivElement> }) {
  return (
    <div
      ref={menuRef}
      className="absolute right-2 z-50 w-40 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5"
      style={MENU_TOP_STYLE}
    >
      {MENU_ITEMS.map((item) => (
        <MenuItem key={item.label} icon={item.icon} label={item.label} />
      ))}
      <div className="px-2 py-1 text-[calc(var(--font-size)-3px)] text-text-muted border-t border-border/40 mt-0.5">
        Coming soon
      </div>
    </div>
  );
}
