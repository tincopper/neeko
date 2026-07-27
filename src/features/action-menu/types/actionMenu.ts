import type { LucideIcon } from 'lucide-react';

export type ActionId =
  | 'new-terminal'
  | 'new-terminal-with-agent'
  | 'new-file'
  | 'open-file'
  | 'recent-files'
  | 'open-side-terminal'
  | 'open-in-ide';

export type ActionGroup = 'terminal' | 'agent' | 'file' | 'quick';

export interface ActionContext {
  projectId: string | null;
  tabKey: string;
  agents: { id: string; name: string; icon?: string | null; enabled: boolean }[];
  recentFiles: string[];
  closeMenu: () => void;
}

export interface ActionRegistryItem {
  id: ActionId;
  group: ActionGroup;
  label: string;
  description?: string;
  icon: LucideIcon;
  shortcut?: string;
  keywords: string[];
  disabled?: boolean;
  visible?: (ctx: ActionContext) => boolean;
  execute: (ctx: ActionContext) => void | Promise<void>;
}
