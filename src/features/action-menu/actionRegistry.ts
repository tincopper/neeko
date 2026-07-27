import {
  FileIcon,
  FolderOpen,
  History,
  TerminalIcon,
  Bot,
  SplitSquareVertical,
  ExternalLink,
} from '@/shared/components/icons';

import type { ActionRegistryItem, ActionContext } from './types/actionMenu';

const ACTION_ITEMS: ActionRegistryItem[] = [
  {
    id: 'new-terminal',
    group: 'terminal',
    label: 'New Terminal',
    description: 'Open a new terminal tab with default shell',
    icon: TerminalIcon,
    keywords: ['terminal', 'shell', 'new', 'tab'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'new-terminal-with-agent',
    group: 'agent',
    label: 'New Terminal with Agent',
    description: 'Open a new terminal tab with an AI agent',
    icon: Bot,
    keywords: ['agent', 'terminal', 'ai', 'assistant'],
    visible: (ctx) => ctx.agents.some((a) => a.enabled),
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-file',
    group: 'file',
    label: 'Open File…',
    description: 'Search and open a file in the current project',
    icon: FolderOpen,
    shortcut: 'Ctrl+P',
    keywords: ['open', 'file', 'goto', 'search'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'new-file',
    group: 'file',
    label: 'New File…',
    description: 'Create a new file in the current project',
    icon: FileIcon,
    keywords: ['new', 'file', 'create'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'recent-files',
    group: 'file',
    label: 'Recent Files',
    description: 'Browse recently opened files',
    icon: History,
    shortcut: 'Ctrl+E',
    keywords: ['recent', 'files', 'history'],
    visible: (ctx) => ctx.recentFiles.length > 0,
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-side-terminal',
    group: 'quick',
    label: 'Open Side Terminal',
    description: 'Toggle the side terminal panel',
    icon: SplitSquareVertical,
    shortcut: 'Ctrl+Alt+T',
    keywords: ['side', 'terminal', 'toggle'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-in-ide',
    group: 'quick',
    label: 'Open in IDE',
    description: 'Open the current project in the configured IDE',
    icon: ExternalLink,
    shortcut: 'Ctrl+O',
    keywords: ['ide', 'open', 'external'],
    execute: (ctx) => ctx.closeMenu(),
  },
];

export function getActionMenuItems(ctx: ActionContext): ActionRegistryItem[] {
  return ACTION_ITEMS.filter((item) => !item.visible || item.visible(ctx));
}

export function getAllActions(): ActionRegistryItem[] {
  return ACTION_ITEMS;
}
