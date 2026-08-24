import type { LucideIcon } from 'lucide-react';

export type ActionId =
  | 'new-terminal'
  | 'new-terminal-with-agent'
  | 'new-browser'
  | 'new-agent-chat'
  | 'new-file'
  | 'open-file'
  | 'recent-files'
  | 'open-side-terminal'
  | 'open-in-ide'
  | 'open-resource-library'
  | 'new-prompt'
  | 'insert-prompt'
  | string;

export type ActionGroup = 'terminal' | 'agent' | 'browser' | 'file' | 'quick' | 'library';

export interface ActionContext {
  projectId: string | null;
  tabKey: string;
  agents: { id: string; name: string; icon?: string | null; enabled: boolean }[];
  recentFiles: string[];
  closeMenu: () => void;
  /** Insert text into the active agent input (when available). */
  insertToAgentInput?: (text: string) => void;
  /** Open the Resource Library panel at a specific kind. */
  openLibrary?: (opts?: { kind?: 'skill' | 'prompt' | 'action' }) => void;
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
